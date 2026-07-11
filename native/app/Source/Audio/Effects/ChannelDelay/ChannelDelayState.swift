//
//  ChannelDelayState.swift
//  eqMac
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

fileprivate struct ChannelDelayMsDefault: DefaultCodableStrategy {
  static var defaultValue: Double = 0
}

/// Default strategy for the whole substate. The integration agent uses it in
/// EffectsState so old persisted state trees keep decoding:
///
///   @DefaultCodable<ChannelDelayStateDefault> var delay = ChannelDelayStateDefault.value
struct ChannelDelayStateDefault: DefaultCodableStrategy {
  static var defaultValue = ChannelDelayState()
}

struct ChannelDelayState: State {
  @DefaultFalse var enabled = false
  /// Left channel delay in milliseconds (0 - 30)
  @DefaultCodable<ChannelDelayMsDefault> var leftMs = ChannelDelayMsDefault.value
  /// Right channel delay in milliseconds (0 - 30)
  @DefaultCodable<ChannelDelayMsDefault> var rightMs = ChannelDelayMsDefault.value
}

enum ChannelDelayAction: Action {
  case setEnabled(Bool)
  case setDelays(Double, Double) // leftMs, rightMs
}

func ChannelDelayStateReducer (action: Action, state: ChannelDelayState?) -> ChannelDelayState {
  var state = state ?? ChannelDelayState()

  switch action as? ChannelDelayAction {
  case .setEnabled(let enabled)?:
    state.enabled = enabled
  case .setDelays(let leftMs, let rightMs)?:
    state.leftMs = leftMs
    state.rightMs = rightMs
  case .none:
    break
  }

  return state
}
