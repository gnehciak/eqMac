//
//  Reverb.swift
//  eqMac
//
//  Spatial audio / reverb environments. Wraps AVAudioUnitReverb as a real
//  node occupying the EffectsChain "reverb" slot, registered by the
//  integration wiring:
//
//    EffectsChain.registerSlot(id: "reverb") { Reverb() }
//
//  The factory runs on EVERY Engine init - the Engine is destroyed and
//  recreated on device change, sample rate change, jack events, EQ type
//  change and sleep / wake - so init fully restores all parameters from
//  the ReSwift store.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import AVFoundation
import EmitterKit

enum ReverbEnvironment: String, Codable, CaseIterable {
  case smallRoom
  case mediumRoom
  case largeRoom
  case mediumHall
  case largeHall
  case plate
  case mediumChamber
  case largeChamber
  case cathedral
  case largeRoom2
  case mediumHall2
  case mediumHall3
  case largeHall2

  var preset: AVAudioUnitReverbPreset {
    switch self {
    case .smallRoom: return .smallRoom
    case .mediumRoom: return .mediumRoom
    case .largeRoom: return .largeRoom
    case .mediumHall: return .mediumHall
    case .largeHall: return .largeHall
    case .plate: return .plate
    case .mediumChamber: return .mediumChamber
    case .largeChamber: return .largeChamber
    case .cathedral: return .cathedral
    case .largeRoom2: return .largeRoom2
    case .mediumHall2: return .mediumHall2
    case .mediumHall3: return .mediumHall3
    case .largeHall2: return .largeHall2
    }
  }
}

let AllReverbEnvironments = ReverbEnvironment.allCases.map { $0.rawValue }

class Reverb: Effect, StoreSubscriber {
  static let defaultEnvironment = ReverbEnvironment.mediumRoom
  static let wetDryMixRange = 0.0...100.0
  static let defaultWetDryMix = 25.0

  // MARK: - Events
  // Static so ReverbDataBus (long lived) can push UI events without holding
  // the owner instance - Reverb is recreated on every Engine init. State
  // changes can come from anywhere (UI, presets, future hotkeys / MIDI).
  static let enabledChanged = EmitterKit.Event<Bool>()
  static let environmentChanged = EmitterKit.Event<ReverbEnvironment>()
  static let wetDryMixChanged = EmitterKit.Event<Double>()

  // MARK: - Properties
  let reverb = AVAudioUnitReverb()

  var state: ReverbState {
    return Application.store.state.effects.reverb
  }

  var environment: ReverbEnvironment {
    return appliedEnvironment ?? Reverb.defaultEnvironment
  }

  var wetDryMix: Double {
    return appliedWetDryMix ?? Reverb.defaultWetDryMix
  }

  // Last applied values - newState fires on every store action, so only
  // touch the node / emit events when something actually changed.
  private var appliedEnabled: Bool?
  private var appliedEnvironment: ReverbEnvironment?
  private var appliedWetDryMix: Double?

  // MARK: - Initialization
  override init () {
    Console.log("Creating Reverb")
    super.init()

    node = reverb

    // Fully reconstruct node params from the store - the EffectsChain slot
    // factory recreates Reverb on every Engine init.
    applyState(state)

    setupStateListener()
  }

  // MARK: - State
  typealias StoreSubscriberStateType = ReverbState

  private func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.effects.reverb }
    }
  }

  func newState (state: ReverbState) {
    applyState(state)
  }

  private func applyState (_ state: ReverbState) {
    let environment = ReverbEnvironment(rawValue: state.environment)
      ?? Reverb.defaultEnvironment

    if environment != appliedEnvironment {
      appliedEnvironment = environment
      reverb.loadFactoryPreset(environment.preset)
      Reverb.environmentChanged.emit(environment)
    }

    if state.wetDryMix != appliedWetDryMix {
      appliedWetDryMix = state.wetDryMix
      reverb.wetDryMix = Float(state.wetDryMix)
      Reverb.wetDryMixChanged.emit(state.wetDryMix)
    }

    if state.enabled != appliedEnabled {
      appliedEnabled = state.enabled
      enabled = state.enabled
      Reverb.enabledChanged.emit(state.enabled)
    }
  }

  override func enabledDidSet () {
    // Bypass instead of detaching the node so the AVAudioEngine graph
    // stays stable - no pipeline rebuild needed to toggle the effect.
    reverb.auAudioUnit.shouldBypassEffect = !enabled
  }

  deinit {
    Application.store.unsubscribe(self)
  }
}
