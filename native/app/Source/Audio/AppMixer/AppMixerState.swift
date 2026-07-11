//
//  AppMixerState.swift
//  eqMac
//
//  Created by Nodeful on 12/07/2026.
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

struct AppVolume: Codable, Equatable {
  var volume: Double = 1
  var muted: Bool = false
}

struct AppMixerState: State {
  var volumes: [String: AppVolume] = [:]
}

// Default strategy for wiring the substate into ApplicationState:
//   @DefaultCodable<AppMixerStateDefault> var appMixer = AppMixerStateDefault.value
struct AppMixerStateDefault: DefaultCodableStrategy {
  static var defaultValue = AppMixerState()
}

enum AppMixerAction: Action {
  case setAppVolume(String, Double, Bool)
  case removeAppVolume(String)
}

func AppMixerStateReducer (action: Action, state: AppMixerState?) -> AppMixerState {
  var state = state ?? AppMixerState()

  switch action as? AppMixerAction {
  case .setAppVolume(let bundleId, let volume, let muted)?:
    state.volumes[bundleId] = AppVolume(volume: volume, muted: muted)
  case .removeAppVolume(let bundleId)?:
    state.volumes.removeValue(forKey: bundleId)
  case .none:
    break
  }

  return state
}
