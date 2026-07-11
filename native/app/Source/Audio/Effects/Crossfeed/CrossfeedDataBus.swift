//
//  CrossfeedDataBus.swift
//  eqMac
//
//  Mounted by the integration wiring in EffectsDataBus:
//
//    self.add("/crossfeed", CrossfeedDataBus.self)
//
//  giving the routes /effects/crossfeed/enabled and
//  /effects/crossfeed/settings.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit

class CrossfeedDataBus: DataBus {

  var state: CrossfeedState {
    return Application.store.state.effects.crossfeed
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
      Application.dispatchAction(CrossfeedAction.setEnabled(enabled))
      return "Crossfeed enabled state has been set"
    }

    self.on(.GET, "/settings") { _, _ in
      return [
        "cutoff": self.state.cutoff,
        "level": self.state.level
      ]
    }

    self.on(.POST, "/settings") { data, _ in
      let cutoff = data["cutoff"] as? Double
      let level = data["level"] as? Double

      if cutoff == nil && level == nil {
        throw "Please provide a 'cutoff' and / or 'level' value"
      }

      if let cutoff = cutoff {
        if cutoff.isNaN || !CrossfeedKernelParams.cutoffRange.contains(cutoff) {
          throw "Invalid 'cutoff' value, must be a number between "
            + String(CrossfeedKernelParams.cutoffRange.lowerBound) + " and "
            + String(CrossfeedKernelParams.cutoffRange.upperBound) + " (Hz)"
        }
        Application.dispatchAction(CrossfeedAction.setCutoff(cutoff))
      }

      if let level = level {
        if level.isNaN || !CrossfeedKernelParams.levelRange.contains(level) {
          throw "Invalid 'level' value, must be a number between "
            + String(CrossfeedKernelParams.levelRange.lowerBound) + " and "
            + String(CrossfeedKernelParams.levelRange.upperBound) + " (dB)"
        }
        Application.dispatchAction(CrossfeedAction.setLevel(level))
      }

      return "Crossfeed settings have been set"
    }

    enabledChangedListener = Crossfeed.enabledChanged.on { enabled in
      self.send(to: "/enabled", data: JSON([ "enabled": enabled ]))
    }

    settingsChangedListener = Crossfeed.settingsChanged.on {
      self.send(to: "/settings", data: JSON([
        "cutoff": self.state.cutoff,
        "level": self.state.level
      ]))
    }
  }
}
