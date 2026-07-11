//
//  Routing.swift
//  eqMac
//
//  Owner of the routing matrix RawDSPKernel. Subscribes to the ReSwift
//  store and applies RoutingState to the kernel through its atomic
//  parameter snapshot. The kernel is registered FIRST in the raw DSP chain
//  by the integration wiring:
//
//    RawDSPChain.register(id: "routing") { Application.routing?.kernel }
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import EmitterKit

class Routing: StoreSubscriber {

  // MARK: - Events
  // Static so RoutingDataBus can push UI events without needing the owner
  // instance (state changes can come from anywhere - UI, hotkeys, MIDI,
  // presets).
  static let enabledChanged = EmitterKit.Event<Bool>()
  static let modeChanged = EmitterKit.Event<RoutingMode>()

  // MARK: - Properties
  let kernel = RoutingKernel()

  var state: RoutingState {
    return Application.store.state.effects.routing
  }

  var enabled: Bool {
    return !kernel.isBypassed
  }

  // Last applied values - newState fires on every store action, so only
  // touch the kernel / emit events when something actually changed.
  private var appliedEnabled: Bool?
  private var appliedMode: RoutingMode?

  // MARK: - Initialization
  init () {
    Console.log("Creating Routing")
    // Fully reconstruct kernel params from the store - the owner outlives
    // the Engine, which is destroyed / recreated on device change, sample
    // rate change, jack events, EQ type change and sleep / wake.
    applyState(state)
    setupStateListener()
  }

  // MARK: - State
  typealias StoreSubscriberStateType = RoutingState

  private func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.effects.routing }
    }
  }

  func newState (state: RoutingState) {
    applyState(state)
  }

  private func applyState (_ state: RoutingState) {
    if state.enabled != appliedEnabled {
      appliedEnabled = state.enabled
      kernel.isBypassed = !state.enabled
      Routing.enabledChanged.emit(state.enabled)
    }

    if state.mode != appliedMode {
      appliedMode = state.mode
      kernel.setMode(state.mode)
      Routing.modeChanged.emit(state.mode)
    }
  }

  deinit {
    Application.store.unsubscribe(self)
  }
}
