//
//  SuperPresetsState.swift
//  eqMac
//
//  Super Presets - automatic Equalizer type + preset switching based on the
//  selected output device or the frontmost application.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

/// Valid values of SuperPresetTrigger.kind
let SuperPresetTriggerKinds = [ "device", "app" ]

/// Raw values of the EqualizerType cases a rule can switch to.
/// "Expert" and "Graphic31" are added to EqualizerType by the integration
/// wiring (case expert = "Expert", case graphic31 = "Graphic31").
let SuperPresetsSupportedEqualizerTypes = [ "Basic", "Advanced", "Expert", "Graphic31" ]

struct SuperPresetTrigger: Codable, Equatable {
  /// One of SuperPresetTriggerKinds ('device' | 'app')
  var kind: String = "device"
  /// Output device UID when kind == 'device'
  var deviceUID: String?
  /// Application Bundle ID when kind == 'app'
  var bundleId: String?
}

struct SuperPresetRule: Codable, Equatable {
  var id: String = UUID().uuidString
  var trigger = SuperPresetTrigger()
  /// Raw value of an EqualizerType case (one of SuperPresetsSupportedEqualizerTypes)
  var equalizerType: String = "Basic"
  var presetId: String = "flat"
  /// Restore the previously selected EQ type + preset when the trigger clears
  var revert: Bool = false
}

fileprivate struct SuperPresetRulesDefault: DefaultCodableStrategy {
  static var defaultValue: [SuperPresetRule] = []
}

/// Default strategy for the whole substate. The integration agent uses it in
/// ApplicationState so previously persisted state trees keep decoding:
///
///   @DefaultCodable<SuperPresetsStateDefault> var superPresets = SuperPresetsStateDefault.value
struct SuperPresetsStateDefault: DefaultCodableStrategy {
  static var defaultValue = SuperPresetsState()
}

struct SuperPresetsState: State {
  @DefaultFalse var enabled = false
  @DefaultCodable<SuperPresetRulesDefault> var rules: [SuperPresetRule] = SuperPresetRulesDefault.value
}

enum SuperPresetsAction: Action {
  case setEnabled(Bool)
  case addRule(SuperPresetRule)
  case updateRule(SuperPresetRule)
  case deleteRule(String)
}

func SuperPresetsStateReducer (action: Action, state: SuperPresetsState?) -> SuperPresetsState {
  var state = state ?? SuperPresetsState()

  switch action as? SuperPresetsAction {
  case .setEnabled(let enabled)?:
    state.enabled = enabled
  case .addRule(let rule)?:
    if let index = state.rules.firstIndex(where: { $0.id == rule.id }) {
      state.rules[index] = rule
    } else {
      state.rules.append(rule)
    }
  case .updateRule(let rule)?:
    if let index = state.rules.firstIndex(where: { $0.id == rule.id }) {
      state.rules[index] = rule
    }
  case .deleteRule(let id)?:
    state.rules.removeAll(where: { $0.id == id })
  case .none:
    break
  }

  return state
}
