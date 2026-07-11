//
//  ChannelDelayDataBus.swift
//  eqMac
//
//  Mounted by the integration wiring in EffectsDataBus:
//
//    self.add("/delay", ChannelDelayDataBus.self)
//
//  giving the routes /effects/delay/enabled and /effects/delay/settings.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit

class ChannelDelayDataBus: DataBus {

  var state: ChannelDelayState {
    return Application.store.state.effects.delay
  }

  var enabledChangedListener: EventListener<Bool>?
  var settingsChangedListener: EventListener<Void>?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/enabled") { _, _ in
      return [ "enabled": self.state.enabled ]
    }

    self.on(.POST, "/enabled") { data, _ in
      guard let enabled = data["enabled"] as? Bool else {
        throw "Invalid 'enabled' value, must be a boolean"
      }
      Application.dispatchAction(ChannelDelayAction.setEnabled(enabled))
      return "Channel Delay enabled state has been set"
    }

    self.on(.GET, "/settings") { _, _ in
      return [
        "leftMs": self.state.leftMs,
        "rightMs": self.state.rightMs
      ]
    }

    self.on(.POST, "/settings") { data, _ in
      let leftMs = data["leftMs"] as? Double
      let rightMs = data["rightMs"] as? Double

      if leftMs == nil && rightMs == nil {
        throw "Please provide a 'leftMs' and / or 'rightMs' value"
      }

      let range = ChannelDelayKernelParams.delayMsRange
      for (name, value) in [ ("leftMs", leftMs), ("rightMs", rightMs) ] {
        if let value = value, value.isNaN || !range.contains(value) {
          throw "Invalid '" + name + "' value, must be a number between "
            + String(range.lowerBound) + " and "
            + String(range.upperBound) + " (ms)"
        }
      }

      Application.dispatchAction(ChannelDelayAction.setDelays(
        leftMs ?? self.state.leftMs,
        rightMs ?? self.state.rightMs
      ))
      return "Channel Delay settings have been set"
    }

    enabledChangedListener = ChannelDelay.enabledChanged.on { enabled in
      self.send(to: "/enabled", data: JSON([ "enabled": enabled ]))
    }

    settingsChangedListener = ChannelDelay.settingsChanged.on {
      self.send(to: "/settings", data: JSON([
        "leftMs": self.state.leftMs,
        "rightMs": self.state.rightMs
      ]))
    }
  }
}
