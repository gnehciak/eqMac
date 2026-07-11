//
//  RecorderState.swift
//  eqMac
//
//  Persisted state for the Recorder feature.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

struct RecorderState: State {
  // Custom recordings folder path. nil = default (~/Music/eqMac Recordings)
  var destinationFolder: String? = nil
}

// Strategy for the integration agent to mount this substate on
// ApplicationState without breaking decoding of previously persisted
// ApplicationState JSON:
// @DefaultCodable<RecorderStateDefault> var recorder = RecorderStateDefault.defaultValue
struct RecorderStateDefault: DefaultCodableStrategy {
  static var defaultValue = RecorderState()
}

enum RecorderAction: Action {
  case setDestinationFolder(String?)
}

func RecorderStateReducer (action: Action, state: RecorderState?) -> RecorderState {
  var state = state ?? RecorderState()

  switch action as? RecorderAction {
  case .setDestinationFolder(let destinationFolder)?:
    state.destinationFolder = destinationFolder
  case .none:
    break
  }

  return state
}
