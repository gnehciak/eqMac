//
//  ExpertEqualizerState.swift
//  eqMac
//
//  Cloned from AdvancedEqualizerState for the Expert parametric Equalizer.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable
import Shared

struct ExpertEqualizerState: State {
  var selectedPresetId: String = "flat"
  var showDefaultPresets: Bool = true
  var transition: Bool = false
}

// Strategy for the integration agent to mount this substate on EqualizersState
// without breaking decoding of previously persisted ApplicationState JSON:
// @DefaultCodable<ExpertEqualizerStateDefault> var expert = ExpertEqualizerStateDefault.defaultValue
struct ExpertEqualizerStateDefault: DefaultCodableStrategy {
  static var defaultValue = ExpertEqualizerState()
}

enum ExpertEqualizerAction: Action {
  case selectPreset(String, Bool)
  case setShowDefaultPresets(Bool)
}

func ExpertEqualizerStateReducer(action: Action, state: ExpertEqualizerState?) -> ExpertEqualizerState {
  var state = state ?? ExpertEqualizerState()

  switch action as? ExpertEqualizerAction {
  case .selectPreset(let id, let transition)?:
    state.selectedPresetId = id
    state.transition = transition
  case .setShowDefaultPresets(let show)?:
    state.showDefaultPresets = show
    Async.delay(100) {
      ExpertEqualizer.presetsChanged.emit(ExpertEqualizer.presets)
    }
  case .none:
    break
  }

  return state
}
