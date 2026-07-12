//
//  RoutingDataBus.swift
//  eqMac
//
//  Mounted by the integration wiring in EffectsDataBus:
//
//    self.add("/routing", RoutingDataBus.self)
//
//  giving the routes /effects/routing/enabled and /effects/routing/mode.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit

class RoutingDataBus: DataBus {

  var state: RoutingState {
    return Application.store.state.effects.routing
  }

  var enabledChangedListener: EventListener<Bool>?
  var modeChangedListener: EventListener<RoutingMode>?
  var polarityChangedListener: EventListener<(Bool, Bool)>?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/enabled") { _, _ in
      return [ "enabled": self.state.enabled ]
    }

    self.on(.POST, "/enabled") { data, _ in
      guard let enabled = data["enabled"] as? Bool else {
        throw "Invalid 'enabled' value, must be a boolean"
      }
      Application.dispatchAction(RoutingAction.setEnabled(enabled))
      return "Routing enabled state has been set"
    }

    self.on(.GET, "/mode") { _, _ in
      return [ "mode": self.state.mode.rawValue ]
    }

    self.on(.POST, "/mode") { data, _ in
      guard let rawMode = data["mode"] as? String,
            let mode = RoutingMode(rawValue: rawMode) else {
        let validModes = RoutingMode.allCases
          .map { $0.rawValue }
          .joined(separator: ", ")
        throw "Invalid 'mode' value, must be one of: " + validModes
      }
      Application.dispatchAction(RoutingAction.setMode(mode))
      return "Routing mode has been set"
    }

    self.on(.GET, "/polarity") { _, _ in
      return [
        "left": self.state.invertLeft,
        "right": self.state.invertRight
      ]
    }

    self.on(.POST, "/polarity") { data, _ in
      let left = data["left"] as? Bool
      let right = data["right"] as? Bool
      guard left != nil || right != nil else {
        throw "Invalid polarity payload, provide 'left' and/or 'right' booleans"
      }
      if let left = left {
        Application.dispatchAction(RoutingAction.setInvertLeft(left))
      }
      if let right = right {
        Application.dispatchAction(RoutingAction.setInvertRight(right))
      }
      return "Polarity inversion has been set"
    }

    enabledChangedListener = Routing.enabledChanged.on { enabled in
      self.send(to: "/enabled", data: JSON([ "enabled": enabled ]))
    }

    modeChangedListener = Routing.modeChanged.on { mode in
      self.send(to: "/mode", data: JSON([ "mode": mode.rawValue ]))
    }

    polarityChangedListener = Routing.polarityChanged.on { invertLeft, invertRight in
      self.send(to: "/polarity", data: JSON([
        "left": invertLeft,
        "right": invertRight
      ]))
    }
  }
}
