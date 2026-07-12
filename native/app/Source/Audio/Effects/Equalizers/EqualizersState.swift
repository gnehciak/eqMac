//
//  EqualizerState.swift
//  eqMac
//
//  Created by Roman Kisil on 29/06/2018.
//  Copyright © 2018 Roman Kisil. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

class EqualizersState: State {
  var enabled = true
  var type: EqualizerType = .basic
  var previousType: EqualizerType?
  var basic = BasicEqualizerState()
  var advanced = AdvancedEqualizerState()
  // @DefaultCodable wrappers keep previously persisted state trees decoding
  // (a bare new field would fail ApplicationState.load()'s try? decode and
  // wipe all user settings)
  @DefaultCodable<ExpertEqualizerStateDefault> var expert = ExpertEqualizerStateDefault.value
  @DefaultCodable<Graphic31EqualizerStateDefault> var graphic31 = Graphic31EqualizerStateDefault.value
}

enum EqualizersAction: Action {
  case setType(EqualizerType)
  case setEnabled(Bool)
}

func EqualizersStateReducer(action: Action, state: EqualizersState?) -> EqualizersState {
  let state = state ?? EqualizersState()
  switch action as? EqualizersAction {
  case .setType(let type)?:
    if (type != state.type) {
      state.previousType = state.type
    }
    state.type = type
  case .setEnabled(let enabled)?:
    state.enabled = enabled
  case .none:
    break
  }
  
  state.basic = BasicEqualizerStateReducer(action: action, state: state.basic)
  state.advanced = AdvancedEqualizerStateReducer(action: action, state: state.advanced)
  state.expert = ExpertEqualizerStateReducer(action: action, state: state.expert)
  state.graphic31 = Graphic31EqualizerStateReducer(action: action, state: state.graphic31)
  
  return state
}
