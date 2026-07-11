//
//  Preamp.swift
//  eqMac
//
//  Preamp gain (-24 - +24 dB) with optional auto-gain: a generalization of
//  BasicEqualizer's peakLimiter that watches the equalizers substate in the
//  ReSwift store (read-only) and compensates the preamp by the active
//  equalizer's maximum positive band gain so boosted bands can't clip.
//
//  The RawDSPKernel lives in this file (kernel + owner vertical). It is
//  registered LAST in the raw DSP chain by the integration wiring:
//
//    RawDSPChain.register(id: "preamp") { Application.preamp?.kernel }
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import Accelerate
import ReSwift
import EmitterKit

// MARK: - Kernel

/// Immutable parameter snapshot published to the render thread via
/// AtomicSnapshot.
final class PreampKernelParams {
  /// Valid range of the USER portion of the gain (validated at the DataBus).
  /// Auto-gain compensation may push the total below -24 dB - that is pure
  /// attenuation and always safe, so the total is only sanity-clamped.
  static let gainRange: ClosedRange<Double> = -24 ... 24

  let totalGainDb: Double
  let gainLinear: Float

  init (totalGainDb: Double) {
    self.totalGainDb = totalGainDb
    self.gainLinear = Float(pow(10.0, min(max(totalGainDb, -96), 24) / 20.0))
  }
}

/// Applies a flat gain to every channel. Steady-state blocks run through
/// vDSP_vsmul (in-place); whenever the target gain changes the block is
/// ramped linearly from the previous gain to the new one, so slider drags
/// and auto-gain jumps stay click-free. Allocation-free and lock-free.
class PreampKernel: RawDSPKernel {

  private let params = AtomicSnapshot<PreampKernelParams>(
    PreampKernelParams(totalGainDb: 0)
  )

  // Render-thread state
  private var currentGain: Float = 1
  private var hasRendered = false

  override init () {
    super.init()
    // Owner enables by clearing this when PreampState.enabled is true
    isBypassed = true
  }

  /// Publish a new total gain (user gain + auto-gain compensation) in dB.
  /// Any non-realtime thread.
  func setTotalGain (db: Double) {
    params.set(PreampKernelParams(totalGainDb: db))
  }

  override func process (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double
  ) {
    guard channelCount > 0, frameCount > 0 else { return }
    let target = params.value?.gainLinear ?? 1

    if !hasRendered {
      // First block after (re)start - jump straight to the target
      currentGain = target
      hasRendered = true
    }

    if currentGain == target {
      if target == 1 { return } // unity - nothing to do
      var gain = target
      for channel in 0 ..< channelCount {
        vDSP_vsmul(
          channelBuffers[channel], 1,
          &gain,
          channelBuffers[channel], 1,
          vDSP_Length(frameCount)
        )
      }
    } else {
      // Gain changed - ramp linearly across this block to avoid clicks
      let step = (target - currentGain) / Float(frameCount)
      for channel in 0 ..< channelCount {
        let buffer = channelBuffers[channel]
        var gain = currentGain
        for frame in 0 ..< frameCount {
          buffer[frame] *= gain
          gain += step
        }
      }
      currentGain = target
    }
  }
}

// MARK: - Owner

class Preamp: StoreSubscriber {

  // MARK: - Events
  // Static so PreampDataBus can push UI events without needing the owner
  // instance (state changes can come from anywhere - UI, hotkeys, MIDI,
  // presets).
  static let enabledChanged = EmitterKit.Event<Bool>()
  static let gainChanged = EmitterKit.Event<Double>()
  static let autoGainChanged = EmitterKit.Event<Bool>()

  // MARK: - Properties
  let kernel = PreampKernel()

  var state: PreampState {
    return Application.store.state.effects.preamp
  }

  var enabled: Bool {
    return !kernel.isBypassed
  }

  /// Current auto-gain compensation in dB (always <= 0)
  private(set) var compensation: Double = 0

  // Last applied values - newState fires on every store action, so only
  // touch the kernel / emit events when something actually changed.
  private var appliedEnabled: Bool?
  private var appliedGain: Double?
  private var appliedAutoGain: Bool?
  private var appliedCompensation: Double?

  // Keep strong references - EmitterKit listeners deallocate otherwise.
  // Preset contents can change (e.g. dragging the Manual preset's sliders)
  // without the equalizers substate changing shape, so watch the preset
  // events as well as the store.
  private var basicPresetsListener: EventListener<[BasicEqualizerPreset]>?
  private var advancedPresetsListener: EventListener<[AdvancedEqualizerPreset]>?

  // MARK: - Initialization
  init () {
    Console.log("Creating Preamp")
    // Fully reconstruct kernel params from the store - the owner outlives
    // the Engine, which is destroyed / recreated on device change, sample
    // rate change, jack events, EQ type change and sleep / wake.
    applyState(Application.store.state.effects)
    setupStateListener()

    basicPresetsListener = BasicEqualizer.presetsChanged.on { _ in
      self.reapply()
    }
    advancedPresetsListener = AdvancedEqualizer.presetsChanged.on { _ in
      self.reapply()
    }
  }

  // MARK: - State
  // Subscribed to the whole EffectsState because auto-gain needs the
  // equalizers substate (read-only) next to our own preamp substate.
  typealias StoreSubscriberStateType = EffectsState

  private func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.effects }
    }
  }

  func newState (state: EffectsState) {
    applyState(state)
  }

  private func reapply () {
    applyState(Application.store.state.effects)
  }

  private func applyState (_ effects: EffectsState) {
    let state = effects.preamp
    let compensation = computeCompensation(
      effects: effects,
      autoGain: state.autoGain
    )

    if state.enabled != appliedEnabled {
      appliedEnabled = state.enabled
      kernel.isBypassed = !state.enabled
      Preamp.enabledChanged.emit(state.enabled)
    }

    if state.gain != appliedGain || compensation != appliedCompensation {
      let gainDidChange = state.gain != appliedGain
      appliedGain = state.gain
      appliedCompensation = compensation
      self.compensation = compensation
      kernel.setTotalGain(db: state.gain + compensation)
      if gainDidChange {
        Preamp.gainChanged.emit(state.gain)
      }
    }

    if state.autoGain != appliedAutoGain {
      appliedAutoGain = state.autoGain
      Preamp.autoGainChanged.emit(state.autoGain)
    }
  }

  /// Generalizes BasicEqualizer's peakLimiter: returns the negative of the
  /// active equalizer's maximum positive gain (0 when nothing is boosted,
  /// auto-gain is off or the equalizers are disabled).
  private func computeCompensation (effects: EffectsState, autoGain: Bool) -> Double {
    guard autoGain else { return 0 }
    let equalizers = effects.equalizers
    guard equalizers.enabled else { return 0 }

    var maxPositiveGain: Double = 0

    // Not a switch on purpose: future equalizer types (e.g. Expert) can be
    // folded in here without breaking compilation the moment the enum grows.
    // Unknown types contribute no compensation.
    if equalizers.type == .basic {
      if let preset = BasicEqualizer.getPreset(id: equalizers.basic.selectedPresetId) {
        // peakLimiter presets already compensate inside the equalizer
        // itself (globalGain = -highestGain) - don't compensate twice
        if !preset.peakLimiter {
          maxPositiveGain = max(
            preset.gains.bass,
            preset.gains.mid,
            preset.gains.treble
          )
        }
      }
    } else if equalizers.type == .advanced {
      if let preset = AdvancedEqualizer.getPreset(id: equalizers.advanced.selectedPresetId) {
        // The global gain shifts every band, so the loudest point of the
        // response is the highest band gain plus the global gain
        maxPositiveGain = (preset.gains.bands.max() ?? 0) + preset.gains.global
      }
    }

    return -max(0, maxPositiveGain)
  }

  deinit {
    Application.store.unsubscribe(self)
  }
}
