//
//  ChannelDelay.swift
//  eqMac
//
//  Owner of the per-channel delay RawDSPKernel. Subscribes to the ReSwift
//  store and applies ChannelDelayState to the kernel through its atomic
//  parameter snapshot, keeping the reported latency (max of the two channel
//  delays) in sync so Output.computeOffset stays consistent. The kernel is
//  registered with RawDSPChain by the integration wiring:
//
//    RawDSPChain.register(id: "delay") { Application.channelDelay?.kernel }
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import EmitterKit

class ChannelDelay: StoreSubscriber {

  // MARK: - Events
  // Static so ChannelDelayDataBus can push UI events without needing the
  // owner instance (state changes can come from anywhere - UI, hotkeys,
  // MIDI, presets).
  static let enabledChanged = EmitterKit.Event<Bool>()
  static let settingsChanged = EmitterKit.Event<Void>()

  // MARK: - Properties
  let kernel = ChannelDelayKernel()

  var state: ChannelDelayState {
    return Application.store.state.effects.delay
  }

  var enabled: Bool {
    return !kernel.isBypassed
  }

  // Last applied values - newState fires on every store action, so only
  // touch the kernel / emit events when something actually changed.
  private var appliedEnabled: Bool?
  private var appliedLeftMs: Double?
  private var appliedRightMs: Double?

  // Keep a strong reference - EmitterKit listeners deallocate otherwise
  private var engineCreatedListener: EventListener<Void>?

  // MARK: - Initialization
  init () {
    Console.log("Creating ChannelDelay")
    // Fully reconstruct kernel params from the store - the owner outlives
    // the Engine, which is destroyed / recreated on device change, sample
    // rate change, jack events, EQ type change and sleep / wake.
    applyState(state)
    setupStateListener()

    // The Engine (and with it the sample rate) is recreated on device /
    // rate changes - refresh the frame-domain latency figure each time.
    engineCreatedListener = Application.engineCreated.on {
      self.updateLatency()
    }
  }

  // MARK: - State
  typealias StoreSubscriberStateType = ChannelDelayState

  private func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.effects.delay }
    }
  }

  func newState (state: ChannelDelayState) {
    applyState(state)
  }

  private func applyState (_ state: ChannelDelayState) {
    var latencyNeedsUpdate = false

    if state.enabled != appliedEnabled {
      appliedEnabled = state.enabled
      kernel.isBypassed = !state.enabled
      // Bypassed kernels are excluded from RawDSPChain.latencyFrames
      latencyNeedsUpdate = true
      ChannelDelay.enabledChanged.emit(state.enabled)
    }

    if state.leftMs != appliedLeftMs || state.rightMs != appliedRightMs {
      appliedLeftMs = state.leftMs
      appliedRightMs = state.rightMs
      kernel.setParameters(leftMs: state.leftMs, rightMs: state.rightMs)
      latencyNeedsUpdate = true
      ChannelDelay.settingsChanged.emit()
    }

    if latencyNeedsUpdate {
      updateLatency()
    }
  }

  /// Report max(left, right) delay through kernel.latencyFrames and get the
  /// Output to recompute its read offset. Uses the same ms -> frames math as
  /// the kernel's render thread (which also self-corrects on rate changes).
  private func updateLatency () {
    let sampleRate = Application.engine?.sampleRate ?? 0
    guard sampleRate > 0 else { return }
    let state = self.state
    kernel.latencyFrames = max(
      ChannelDelayKernel.delayFrames(ms: state.leftMs, sampleRate: sampleRate),
      ChannelDelayKernel.delayFrames(ms: state.rightMs, sampleRate: sampleRate)
    )
    Application.output?.resetOffsets()
  }

  deinit {
    Application.store.unsubscribe(self)
  }
}
