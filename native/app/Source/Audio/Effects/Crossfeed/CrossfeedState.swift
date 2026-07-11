//
//  CrossfeedState.swift
//  eqMac
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

fileprivate struct CrossfeedCutoffDefault: DefaultCodableStrategy {
  static var defaultValue: Double = CrossfeedKernelParams.defaultCutoff
}

fileprivate struct CrossfeedLevelDefault: DefaultCodableStrategy {
  static var defaultValue: Double = CrossfeedKernelParams.defaultLevel
}

/// Default strategy for the whole substate. The integration agent uses it in
/// EffectsState so old persisted state trees keep decoding:
///
///   @DefaultCodable<CrossfeedStateDefault> var crossfeed = CrossfeedStateDefault.value
struct CrossfeedStateDefault: DefaultCodableStrategy {
  static var defaultValue = CrossfeedState()
}

struct CrossfeedState: State {
  @DefaultFalse var enabled = false
  /// Cross path lowpass cutoff in Hz (300 - 2000)
  @DefaultCodable<CrossfeedCutoffDefault> var cutoff = CrossfeedCutoffDefault.value
  /// Cross path attenuation in dB (1 - 15, lower = stronger crossfeed)
  @DefaultCodable<CrossfeedLevelDefault> var level = CrossfeedLevelDefault.value
}

enum CrossfeedAction: Action {
  case setEnabled(Bool)
  case setCutoff(Double)
  case setLevel(Double)
}

func CrossfeedStateReducer (action: Action, state: CrossfeedState?) -> CrossfeedState {
  var state = state ?? CrossfeedState()

  switch action as? CrossfeedAction {
  case .setEnabled(let enabled)?:
    state.enabled = enabled
  case .setCutoff(let cutoff)?:
    state.cutoff = cutoff
  case .setLevel(let level)?:
    state.level = level
  case .none:
    break
  }

  return state
}
