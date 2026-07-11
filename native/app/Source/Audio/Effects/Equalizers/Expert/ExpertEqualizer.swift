//
//  ExpertEqualizer.swift
//  eqMac
//
//  Expert parametric Equalizer.
//  Follows the AdvancedEqualizer vertical slice, but the DSP does NOT live in
//  an AVAudioUnitEQ - the inherited node is a 0 band passthrough that only
//  anchors the house Equalizer shape in the AVAudioEngine graph. All actual
//  processing happens in ExpertEqualizerKernel, which the integration agent
//  registers with the raw DSP chain once at Application setup:
//
//    RawDSPChain.register(id: "expert-equalizer") { ExpertEqualizer.kernel }
//

import Foundation
import ReSwift
import EmitterKit
import SwiftyUserDefaults
import Shared

class ExpertEqualizer: Equalizer, StoreSubscriber {
  /// Raw value of the EqualizerType case the integration agent adds
  /// (case expert = "Expert")
  static let TYPE = "Expert"

  /// The raw DSP kernel performing all Expert Equalizer processing.
  /// Long-lived singleton: it outlives Engine (and ExpertEqualizer instance)
  /// recreation on device / sample rate / EQ type change and sleep/wake -
  /// RawDSPChain re-queries the provider closure on every Engine init.
  static let kernel: ExpertEqualizerKernel = {
    let kernel = ExpertEqualizerKernel()
    // Stays bypassed until an ExpertEqualizer instance becomes the active,
    // enabled Equalizer
    kernel.isBypassed = true
    return kernel
  }()

  static let defaultPresets: [ExpertEqualizerPreset] = EXPERT_EQUALIZER_DEFAULT_PRESETS.map { preset in
    let (name, bands) = preset
    return ExpertEqualizerPreset(
      id: (name as String).camelCasedString,
      name: name,
      isDefault: true,
      bands: bands,
      globalGain: 0
    )
  }

  static var userPresets: [ExpertEqualizerPreset] {
    get {
      return Storage[.expertEqualizerPresets] ?? []
    }
    set (newPresets) {
      Storage[.expertEqualizerPresets] = newPresets
      presetsChanged.emit(presets)
    }
  }

  static var presets: [ExpertEqualizerPreset] {
    get {
      var presets: [ExpertEqualizerPreset] = self.userPresets
      let hasManual = presets.contains { $0.id == "manual" }
      if (!hasManual) {
        presets.append(ExpertEqualizerPreset(
          id: "manual",
          name: "Manual",
          isDefault: true,
          bands: [],
          globalGain: 0
        ))
      }
      if (Application.store.state.effects.equalizers.expert.showDefaultPresets) {
        presets += self.defaultPresets
      } else {
        let flatPreset = self.defaultPresets.first { $0.id == "flat" }
        presets.append(flatPreset!)
      }

      return presets
    }
  }

  static func getPreset (id: String) -> ExpertEqualizerPreset? {
    return self.presets.first(where: { $0.id == id })
  }

  static func createPreset (name: String, bands: [ExpertEqualizerPresetBand], globalGain: Double) -> ExpertEqualizerPreset {
    let preset = ExpertEqualizerPreset(
      id: UUID().uuidString,
      name: name,
      isDefault: false,
      bands: bands,
      globalGain: globalGain
    )
    self.userPresets.append(preset)
    presetsChanged.emit(presets)
    return preset
  }

  static func updatePreset (id: String, bands: [ExpertEqualizerPresetBand], globalGain: Double) {
    var presets = self.userPresets
    if var preset = self.getPreset(id: id) {
      preset = ExpertEqualizerPreset(
        id: id,
        name: preset.name,
        isDefault: false,
        bands: bands,
        globalGain: globalGain
      )
      presets.removeAll(where: { $0.id == preset.id })
      presets.append(preset)
      self.userPresets = presets
      presetsChanged.emit(self.presets)
    }
  }

  static func deletePreset (_ preset: ExpertEqualizerPreset) {
    self.userPresets.removeAll(where: { $0.id == preset.id })
    presetsChanged.emit(presets)
  }

  static var presetsChanged = Event<[ExpertEqualizerPreset]>()
  /// Static twin of the instance event below so ExpertEqualizerDataBus can
  /// keep pushing /presets/selected across Engine (instance) recreations
  static var selectedPresetChanged = Event<ExpertEqualizerPreset>()
  var selectedPresetChanged = Event<ExpertEqualizerPreset>()

  // Snapshot swaps preserve the per-band filter state so preset changes are
  // inherently smooth - the flag is kept for shape parity with the other
  // Equalizers.
  var transition = false

  var selectedPreset: ExpertEqualizerPreset = ExpertEqualizer.getPreset(id: "flat")! {
    didSet {
      updateKernel()
      selectedPresetChanged.emit(selectedPreset)
      ExpertEqualizer.selectedPresetChanged.emit(selectedPreset)
    }
  }

  var state: ExpertEqualizerState {
    return Application.store.state.effects.equalizers.expert
  }

  init () {
    Console.log("Creating Expert Equalizer")

    // 0 band AVAudioUnitEQ = passthrough node
    super.init(numberOfBands: 0)

    if let preset = ExpertEqualizer.getPreset(id: self.state.selectedPresetId) {
      ({ self.selectedPreset = preset })()
    } else {
      ({ self.selectedPreset = ExpertEqualizer.getPreset(id: "flat")! })()
    }
    setupStateListener()
  }

  func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.effects.equalizers.expert }
    }
  }

  func newState (state: ExpertEqualizerState) {
    if let preset = ExpertEqualizer.getPreset(id: state.selectedPresetId) {
      if (selectedPreset.id != state.selectedPresetId
            || selectedPreset.bands != preset.bands
            || selectedPreset.globalGain != preset.globalGain) {
        transition = state.transition
        selectedPreset = preset
      }
    }
  }
  typealias StoreSubscriberStateType = ExpertEqualizerState

  override func enabledDidSet () {
    super.enabledDidSet()
    ExpertEqualizer.kernel.isBypassed = !enabled
  }

  /// Fully reconstructs the kernel parameters from the selected preset
  private func updateKernel () {
    let bands: [ExpertEqualizerKernelBand] = selectedPreset.bands.compactMap { band in
      guard let type = BiquadFilterType(rawValue: band.type) else { return nil }
      guard let channel = ExpertEqualizerKernelBandChannel(rawValue: band.channel) else { return nil }
      return ExpertEqualizerKernelBand(
        id: band.id,
        type: type,
        frequency: band.frequency,
        gain: band.gain,
        q: band.q,
        channel: channel,
        enabled: band.enabled
      )
    }
    ExpertEqualizer.kernel.setParameters(
      bands: bands,
      globalGain: selectedPreset.globalGain,
      sampleRateHint: Application.engine?.sampleRate ?? 0
    )
  }

  deinit {
    Application.store.unsubscribe(self)
    // The kernel outlives this instance - keep it running only if the Expert
    // Equalizer is still the active, enabled Equalizer (Engine recreation),
    // bypass it otherwise (EQ type switched away / teardown)
    let equalizers = Application.store.state.effects.equalizers
    let stillActive = equalizers.enabled && equalizers.type.rawValue == ExpertEqualizer.TYPE
    ExpertEqualizer.kernel.isBypassed = !stillActive
  }
}
