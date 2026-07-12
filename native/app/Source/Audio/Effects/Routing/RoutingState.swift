//
//  RoutingState.swift
//  eqMac
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

fileprivate struct RoutingModeDefault: DefaultCodableStrategy {
  static var defaultValue: RoutingMode = .stereo
}

/// Default strategy for the whole substate. The integration agent uses it in
/// EffectsState so old persisted state trees keep decoding:
///
///   @DefaultCodable<RoutingStateDefault> var routing = RoutingStateDefault.value
struct RoutingStateDefault: DefaultCodableStrategy {
  static var defaultValue = RoutingState()
}

struct RoutingState: State {
  @DefaultFalse var enabled = false
  @DefaultCodable<RoutingModeDefault> var mode = RoutingModeDefault.value
  // Peace-style per-channel polarity (phase) inversion
  @DefaultFalse var invertLeft = false
  @DefaultFalse var invertRight = false
}

enum RoutingAction: Action {
  case setEnabled(Bool)
  case setMode(RoutingMode)
  case setInvertLeft(Bool)
  case setInvertRight(Bool)
}

func RoutingStateReducer (action: Action, state: RoutingState?) -> RoutingState {
  var state = state ?? RoutingState()

  switch action as? RoutingAction {
  case .setEnabled(let enabled)?:
    state.enabled = enabled
  case .setMode(let mode)?:
    state.mode = mode
  case .setInvertLeft(let invert)?:
    state.invertLeft = invert
  case .setInvertRight(let invert)?:
    state.invertRight = invert
  case .none:
    break
  }

  return state
}
