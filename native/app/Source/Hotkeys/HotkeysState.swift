//
//  HotkeysState.swift
//  eqMac
//
//  Persisted global hotkey bindings.
//
//  Mounted on ApplicationState by the integration wiring:
//
//    @DefaultCodable<HotkeysStateDefault> var hotkeys = HotkeysStateDefault.defaultValue
//
//  and reduced from ApplicationStateReducer:
//
//    state.hotkeys = HotkeysStateReducer(action: action, state: state.hotkeys)
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

/// Every action a global hotkey can trigger.
/// Raw values are the wire contract with the UI (HotkeysService /
/// hotkeys-dialog) and the keys of HotkeysState.bindings - do not rename.
enum HotkeyAction: String, Codable, CaseIterable {
  case volumeUp = "volumeUp"
  case volumeDown = "volumeDown"
  case muteToggle = "muteToggle"
  case boostToggle = "boostToggle"
  case nextPreset = "nextPreset"
  case previousPreset = "previousPreset"
  case eqMacEnabledToggle = "eqMacEnabledToggle"
  case showHideWindow = "showHideWindow"
}

/// A single key combination bound to a HotkeyAction.
/// - keyCode: macOS virtual key code (kVK_*)
/// - modifiers: Carbon modifier flags (cmdKey | shiftKey | optionKey | controlKey)
struct HotkeyBinding: Codable, Equatable {
  var keyCode: UInt32
  var modifiers: UInt32
  var enabled: Bool = true
}

struct HotkeysState: State {
  /// Keyed by HotkeyAction.rawValue
  var bindings: [String: HotkeyBinding] = [:]
}

/// Strategy for the integration agent to mount this substate on
/// ApplicationState without breaking decoding of previously persisted
/// state JSON (a bare non-optional field would wipe all user settings).
struct HotkeysStateDefault: DefaultCodableStrategy {
  static var defaultValue = HotkeysState()
}

enum HotkeysAction: Action {
  case setBinding(String, HotkeyBinding)
  case removeBinding(String)
}

func HotkeysStateReducer (action: Action, state: HotkeysState?) -> HotkeysState {
  var state = state ?? HotkeysState()

  switch action as? HotkeysAction {
  case .setBinding(let actionId, let binding)?:
    state.bindings[actionId] = binding
  case .removeBinding(let actionId)?:
    state.bindings.removeValue(forKey: actionId)
  case .none:
    break
  }

  return state
}
