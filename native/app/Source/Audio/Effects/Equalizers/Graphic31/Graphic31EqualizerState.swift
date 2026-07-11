//
//  Graphic31EqualizerState.swift
//  eqMac
//
//  Mechanical clone of AdvancedEqualizerState for the 31 Band Graphic Equalizer.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable
import Shared

struct Graphic31EqualizerState: State {
  var selectedPresetId: String = "flat"
  var showDefaultPresets: Bool = true
  var transition: Bool = false
}

// Strategy for the integration agent to mount this substate on EqualizersState
// without breaking decoding of previously persisted ApplicationState JSON:
// @DefaultCodable<Graphic31EqualizerStateDefault> var graphic31 = Graphic31EqualizerStateDefault.defaultValue
struct Graphic31EqualizerStateDefault: DefaultCodableStrategy {
  static var defaultValue = Graphic31EqualizerState()
}

enum Graphic31EqualizerAction: Action {
  case selectPreset(String, Bool)
  case setShowDefaultPresets(Bool)
}

func Graphic31EqualizerStateReducer(action: Action, state: Graphic31EqualizerState?) -> Graphic31EqualizerState {
  var state = state ?? Graphic31EqualizerState()

  switch action as? Graphic31EqualizerAction {
  case .selectPreset(let id, let transition)?:
    state.selectedPresetId = id
    state.transition = transition
  case .setShowDefaultPresets(let show)?:
    state.showDefaultPresets = show
    Async.delay(100) {
      Graphic31Equalizer.presetsChanged.emit(Graphic31Equalizer.presets)
    }
  case .none:
    break
  }

  return state
}
