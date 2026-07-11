//
//  PreampState.swift
//  eqMac
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

fileprivate struct PreampGainDefault: DefaultCodableStrategy {
  static var defaultValue: Double = 0
}

/// Default strategy for the whole substate. The integration agent uses it in
/// EffectsState so old persisted state trees keep decoding:
///
///   @DefaultCodable<PreampStateDefault> var preamp = PreampStateDefault.value
struct PreampStateDefault: DefaultCodableStrategy {
  static var defaultValue = PreampState()
}

struct PreampState: State {
  @DefaultFalse var enabled = false
  /// User preamp gain in dB (-24 - +24)
  @DefaultCodable<PreampGainDefault> var gain = PreampGainDefault.value
  /// When true the preamp automatically compensates for the active
  /// equalizer's maximum positive band gain (generalized peak limiter)
  @DefaultFalse var autoGain = false
}

enum PreampAction: Action {
  case setEnabled(Bool)
  case setGain(Double)
  case setAutoGain(Bool)
}

func PreampStateReducer (action: Action, state: PreampState?) -> PreampState {
  var state = state ?? PreampState()

  switch action as? PreampAction {
  case .setEnabled(let enabled)?:
    state.enabled = enabled
  case .setGain(let gain)?:
    state.gain = gain
  case .setAutoGain(let autoGain)?:
    state.autoGain = autoGain
  case .none:
    break
  }

  return state
}
