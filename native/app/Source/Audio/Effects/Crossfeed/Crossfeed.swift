//
//  Crossfeed.swift
//  eqMac
//
//  Owner of the crossfeed RawDSPKernel. Subscribes to the ReSwift store and
//  applies CrossfeedState to the kernel through its atomic parameter
//  snapshot. The kernel itself is registered with RawDSPChain by the
//  integration wiring:
//
//    RawDSPChain.register(id: "crossfeed") { Application.crossfeed?.kernel }
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import EmitterKit

class Crossfeed: StoreSubscriber {

  // MARK: - Events
  // Static so CrossfeedDataBus can push UI events without needing the
  // owner instance (state changes can come from anywhere - UI, hotkeys,
  // MIDI, presets).
  static let enabledChanged = EmitterKit.Event<Bool>()
  static let settingsChanged = EmitterKit.Event<Void>()

  // MARK: - Properties
  let kernel = CrossfeedKernel()

  var state: CrossfeedState {
    return Application.store.state.effects.crossfeed
  }

  var enabled: Bool {
    return !kernel.isBypassed
  }

  // Last applied values - newState fires on every store action, so only
  // touch the kernel / emit events when something actually changed.
  private var appliedEnabled: Bool?
  private var appliedCutoff: Double?
  private var appliedLevel: Double?

  // MARK: - Initialization
  init () {
    Console.log("Creating Crossfeed")
    // Fully reconstruct kernel params from the store - the owner outlives
    // the Engine, which is destroyed / recreated on device change, sample
    // rate change, jack events, EQ type change and sleep / wake.
    applyState(state)
    setupStateListener()
  }

  // MARK: - State
  typealias StoreSubscriberStateType = CrossfeedState

  private func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.effects.crossfeed }
    }
  }

  func newState (state: CrossfeedState) {
    applyState(state)
  }

  private func applyState (_ state: CrossfeedState) {
    if state.enabled != appliedEnabled {
      appliedEnabled = state.enabled
      kernel.isBypassed = !state.enabled
      Crossfeed.enabledChanged.emit(state.enabled)
    }

    if state.cutoff != appliedCutoff || state.level != appliedLevel {
      appliedCutoff = state.cutoff
      appliedLevel = state.level
      kernel.setParameters(cutoff: state.cutoff, level: state.level)
      Crossfeed.settingsChanged.emit()
    }
  }

  deinit {
    Application.store.unsubscribe(self)
  }
}
