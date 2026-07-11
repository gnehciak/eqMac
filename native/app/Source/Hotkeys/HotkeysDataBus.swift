//
//  HotkeysDataBus.swift
//  eqMac
//
//  Mounted by the integration wiring in ApplicationDataBus:
//
//    self.add("/hotkeys", HotkeysDataBus.self)
//
//  Routes:
//    GET    /hotkeys/bindings  -> { bindings: { <action>: { keyCode, modifiers, enabled, display } } }
//    POST   /hotkeys/bindings  <- { action, keyCode, modifiers, enabled }
//    DELETE /hotkeys/bindings  <- { action }
//    POST   /hotkeys/capture   <- { action } -> async { keyCode, modifiers, display } | { cancelled: true }
//  Push:
//    /hotkeys/bindings         -> same payload as GET
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit

class HotkeysDataBus: DataBus {

  var state: HotkeysState {
    return Application.store.state.hotkeys
  }

  var bindingsChangedListener: EventListener<Void>?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/bindings") { _, _ in
      return [ "bindings": HotkeysDataBus.bindingsPayload(self.state.bindings) ]
    }

    self.on(.POST, "/bindings") { data, _ in
      let actionId = try HotkeysDataBus.validActionId(data)

      guard let keyCode = data["keyCode"] as? Double,
        !keyCode.isNaN,
        keyCode >= 0, keyCode <= 65535,
        keyCode == keyCode.rounded() else {
        throw "Invalid 'keyCode' parameter, must be an integer between 0 and 65535"
      }

      guard let modifiers = data["modifiers"] as? Double,
        !modifiers.isNaN,
        modifiers >= 0, modifiers <= Double(UInt32.max),
        modifiers == modifiers.rounded(),
        UInt32(modifiers) & ~HotkeyManager.validModifiersMask == 0 else {
        throw "Invalid 'modifiers' parameter, must be a mask of Carbon modifier flags (⌘ 256, ⇧ 512, ⌥ 2048, ⌃ 4096)"
      }

      let enabled = data["enabled"] as? Bool ?? true

      let binding = HotkeyBinding(
        keyCode: UInt32(keyCode),
        modifiers: UInt32(modifiers),
        enabled: enabled
      )
      Application.dispatchAction(HotkeysAction.setBinding(actionId, binding))
      return "Hotkey binding has been set"
    }

    self.on(.DELETE, "/bindings") { data, _ in
      let actionId = try HotkeysDataBus.validActionId(data)
      Application.dispatchAction(HotkeysAction.removeBinding(actionId))
      return "Hotkey binding has been removed"
    }

    self.on(.POST, "/capture") { data, res in
      _ = try HotkeysDataBus.validActionId(data)

      guard let manager = HotkeyManager.shared else {
        throw "Hotkeys are not available"
      }

      // Keep the native timeout below the 15s transport dispatch timeout
      manager.startCapture(timeout: 10000) { captured in
        guard let captured = captured else {
          res.send(JSON([ "cancelled": true ]))
          return
        }
        res.send(JSON([
          "keyCode": Int(captured.keyCode),
          "modifiers": Int(captured.modifiers),
          "display": captured.display
        ]))
      }

      return nil
    }

    bindingsChangedListener = HotkeyManager.bindingsChanged.on { [weak self] in
      guard let self = self else { return }
      self.send(to: "/bindings", data: JSON([
        "bindings": HotkeysDataBus.bindingsPayload(self.state.bindings)
      ]))
    }
  }

  private static func validActionId (_ data: JSON?) throws -> String {
    guard let actionId = data["action"] as? String,
      HotkeyAction(rawValue: actionId) != nil else {
      let all = HotkeyAction.allCases.map { $0.rawValue }.joined(separator: ", ")
      throw "Invalid 'action' parameter, must be one of: \(all)"
    }
    return actionId
  }

  static func bindingsPayload (_ bindings: [String: HotkeyBinding]) -> [String: Any] {
    var payload: [String: Any] = [:]
    for (actionId, binding) in bindings {
      payload[actionId] = [
        "keyCode": Int(binding.keyCode),
        "modifiers": Int(binding.modifiers),
        "enabled": binding.enabled,
        "display": HotkeyManager.display(keyCode: binding.keyCode, modifiers: binding.modifiers)
      ]
    }
    return payload
  }
}
