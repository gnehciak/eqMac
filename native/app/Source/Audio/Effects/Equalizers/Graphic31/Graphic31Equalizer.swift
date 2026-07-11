//
//  Graphic31Equalizer.swift
//  eqMac
//
//  31 Band (ISO third-octave) Graphic Equalizer.
//  Mechanical clone of the AdvancedEqualizer vertical slice.
//

import Foundation
import ReSwift
import EmitterKit
import SwiftyUserDefaults
import Shared

class Graphic31Equalizer: Equalizer, StoreSubscriber {
  // ISO third-octave center frequencies, 20 Hz - 20 kHz
  static let frequencies: [Double] = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1_000, 1_250, 1_600,
    2_000, 2_500, 3_150, 4_000, 5_000, 6_300, 8_000, 10_000, 12_500, 16_000,
    20_000
  ]

  // Third of an octave bandwidth per band
  static let bandwidth: Double = 1.0 / 3.0

  // Default presets are the 10 band Advanced Equalizer tables
  // interpolated to 31 bands (linear interpolation in log-frequency space)
  static let defaultPresets: [Graphic31EqualizerPreset] = ADVANCED_EQUALIZER_DEFAULT_PRESETS.map { preset in
    let (name, bands) = preset
    return Graphic31EqualizerPreset(
      id: (name as String).camelCasedString,
      name: name,
      isDefault: true,
      gains: Graphic31EqualizerPresetGains(
        global: 0,
        bands: Graphic31Equalizer.interpolate(tenBandGains: bands)
      )
    )
  }

  static func interpolate (tenBandGains: [Double]) -> [Double] {
    let sourceFrequencies = AdvancedEqualizer.frequencies
    guard tenBandGains.count == sourceFrequencies.count, sourceFrequencies.count > 1 else {
      return Array(repeating: 0, count: frequencies.count)
    }
    let sourcePositions = sourceFrequencies.map { log10($0) }
    return frequencies.map { frequency -> Double in
      let position = log10(frequency)
      if (position <= sourcePositions.first!) {
        return tenBandGains.first!
      }
      if (position >= sourcePositions.last!) {
        return tenBandGains.last!
      }
      var upperIndex = 1
      while upperIndex < sourcePositions.count - 1 && sourcePositions[upperIndex] < position {
        upperIndex += 1
      }
      let lowerIndex = upperIndex - 1
      let segment = sourcePositions[upperIndex] - sourcePositions[lowerIndex]
      let ratio = segment == 0 ? 0 : (position - sourcePositions[lowerIndex]) / segment
      return tenBandGains[lowerIndex] + (tenBandGains[upperIndex] - tenBandGains[lowerIndex]) * ratio
    }
  }

  static var userPresets: [Graphic31EqualizerPreset] {
    get {
      return Storage[.graphic31EqualizerPresets] ?? []
    }
    set (newPresets) {
      Storage[.graphic31EqualizerPresets] = newPresets
      presetsChanged.emit(presets)
    }
  }

  static var presets: [Graphic31EqualizerPreset] {
    get {
      var presets: [Graphic31EqualizerPreset] = self.userPresets
      let hasManual = presets.contains { $0.id == "manual" }
      if (!hasManual) {
        presets.append(Graphic31EqualizerPreset(
          id: "manual",
          name: "Manual",
          isDefault: true,
          gains: Graphic31EqualizerPresetGains(
            global: 0,
            bands: Array(repeating: 0, count: Graphic31Equalizer.frequencies.count)
          )
        ))
      }
      if (Application.store.state.effects.equalizers.graphic31.showDefaultPresets) {
        presets += self.defaultPresets
      } else {
        let flatPreset = self.defaultPresets.first { $0.id == "flat" }
        presets.append(flatPreset!)
      }

      return presets
    }
  }

  static func getPreset (id: String) -> Graphic31EqualizerPreset? {
    return self.presets.first(where: { $0.id == id })
  }

  static func createPreset (name: String, gains: Graphic31EqualizerPresetGains) -> Graphic31EqualizerPreset {
    let preset = Graphic31EqualizerPreset(
      id: UUID().uuidString,
      name: name,
      isDefault: false,
      gains: gains
    )
    self.userPresets.append(preset)
    presetsChanged.emit(presets)
    return preset
  }

  static func updatePreset (id: String, gains: Graphic31EqualizerPresetGains) {
    var presets = self.userPresets
    if var preset = self.getPreset(id: id) {
      preset = Graphic31EqualizerPreset(id: id, name: preset.name, isDefault: false, gains: gains)
      presets.removeAll(where: { $0.id == preset.id })
      presets.append(preset)
      self.userPresets = presets
      presetsChanged.emit(presets)
    }
  }

  static func deletePreset (_ preset: Graphic31EqualizerPreset) {
    self.userPresets.removeAll(where: { $0.id == preset.id })
    presetsChanged.emit(presets)
  }

  static var presetsChanged = Event<[Graphic31EqualizerPreset]>()
  var selectedPresetChanged = Event<Graphic31EqualizerPreset>()

  var transition = false

  var selectedPreset: Graphic31EqualizerPreset = Graphic31Equalizer.getPreset(id: "flat")! {
    didSet {
      if (transition) {
        Transition.perform(from: globalGain, to: selectedPreset.gains.global) { gainStep in
          self.globalGain = gainStep
        }
      } else {
        globalGain = selectedPreset.gains.global
      }
      for (index, gain) in selectedPreset.gains.bands.enumerated() {
        if (transition) {
          Transition.perform(from: getGain(index: index), to: gain) { gainStep in
            self.setGain(index: index, gain: gainStep)
          }
        } else {
          setGain(index: index, gain: gain)
        }
      }
      selectedPresetChanged.emit(selectedPreset)
    }
  }

  var state: Graphic31EqualizerState {
    return Application.store.state.effects.equalizers.graphic31
  }

  init () {
    Console.log("Creating Graphic 31 Equalizer")

    super.init(numberOfBands: Graphic31Equalizer.frequencies.count)

    for band in eq.bands {
      band.bandwidth = Float(Graphic31Equalizer.bandwidth)
    }

    for (index, frequency) in Graphic31Equalizer.frequencies.enumerated() {
      setFrequency(index: index, frequency: frequency)
    }

    if let preset = Graphic31Equalizer.getPreset(id: self.state.selectedPresetId) {
      ({ self.selectedPreset = preset })()
    }
    setupStateListener()
  }

  func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.effects.equalizers.graphic31 }
    }
  }

  func newState(state: Graphic31EqualizerState) {
    if let preset = Graphic31Equalizer.getPreset(id: state.selectedPresetId) {
      if (selectedPreset.id != state.selectedPresetId || selectedPreset.gains != preset.gains) {
        transition = state.transition
        selectedPreset = preset
      }
    }
  }
  typealias StoreSubscriberStateType = Graphic31EqualizerState

  deinit {
    Application.store.unsubscribe(self)
  }
}
