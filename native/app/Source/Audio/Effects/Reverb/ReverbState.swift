//
//  ReverbState.swift
//  eqMac
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

fileprivate struct ReverbEnvironmentDefault: DefaultCodableStrategy {
  static var defaultValue: String = Reverb.defaultEnvironment.rawValue
}

fileprivate struct ReverbWetDryMixDefault: DefaultCodableStrategy {
  static var defaultValue: Double = Reverb.defaultWetDryMix
}

/// Default strategy for the whole substate. The integration agent uses it in
/// EffectsState so old persisted state trees keep decoding:
///
///   @DefaultCodable<ReverbStateDefault> var reverb = ReverbStateDefault.value
struct ReverbStateDefault: DefaultCodableStrategy {
  static var defaultValue = ReverbState()
}

struct ReverbState: State {
  @DefaultFalse var enabled = false
  /// One of AllReverbEnvironments (ReverbEnvironment raw values)
  @DefaultCodable<ReverbEnvironmentDefault> var environment = ReverbEnvironmentDefault.value
  /// Wet / Dry blend in percent (0 = fully dry, 100 = fully wet)
  @DefaultCodable<ReverbWetDryMixDefault> var wetDryMix = ReverbWetDryMixDefault.value
}

enum ReverbAction: Action {
  case setEnabled(Bool)
  case setEnvironment(ReverbEnvironment)
  case setWetDryMix(Double)
}

func ReverbStateReducer (action: Action, state: ReverbState?) -> ReverbState {
  var state = state ?? ReverbState()

  switch action as? ReverbAction {
  case .setEnabled(let enabled)?:
    state.enabled = enabled
  case .setEnvironment(let environment)?:
    state.environment = environment.rawValue
  case .setWetDryMix(let wetDryMix)?:
    state.wetDryMix = wetDryMix
  case .none:
    break
  }

  return state
}
