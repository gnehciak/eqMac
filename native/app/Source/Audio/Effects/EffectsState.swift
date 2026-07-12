//
//  EffectsState.swift
//  eqMac
//
//  Created by Roman Kisil on 29/06/2018.
//  Copyright © 2018 Roman Kisil. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

struct EffectsState: State {
  var equalizers = EqualizersState()
  // @DefaultCodable wrappers keep previously persisted state trees decoding
  // (a bare new field would fail ApplicationState.load()'s try? decode and
  // wipe all user settings)
  @DefaultCodable<RoutingStateDefault> var routing = RoutingStateDefault.value
  @DefaultCodable<CrossfeedStateDefault> var crossfeed = CrossfeedStateDefault.value
  @DefaultCodable<ChannelDelayStateDefault> var delay = ChannelDelayStateDefault.value
  @DefaultCodable<PreampStateDefault> var preamp = PreampStateDefault.value
  @DefaultCodable<ReverbStateDefault> var reverb = ReverbStateDefault.value
  @DefaultCodable<AudioUnitsStateDefault> var audioUnits = AudioUnitsStateDefault.value
}

func EffectsStateReducer(action: Action, state: EffectsState?) -> EffectsState {
  var state = state ?? EffectsState()

  state.equalizers = EqualizersStateReducer(action: action, state: state.equalizers)
  state.routing = RoutingStateReducer(action: action, state: state.routing)
  state.crossfeed = CrossfeedStateReducer(action: action, state: state.crossfeed)
  state.delay = ChannelDelayStateReducer(action: action, state: state.delay)
  state.preamp = PreampStateReducer(action: action, state: state.preamp)
  state.reverb = ReverbStateReducer(action: action, state: state.reverb)
  state.audioUnits = AudioUnitsStateReducer(action: action, state: state.audioUnits)

  return state
}
