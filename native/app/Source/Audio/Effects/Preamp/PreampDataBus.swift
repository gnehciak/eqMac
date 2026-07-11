//
//  PreampDataBus.swift
//  eqMac
//
//  Mounted by the integration wiring in EffectsDataBus:
//
//    self.add("/preamp", PreampDataBus.self)
//
//  giving the routes /effects/preamp/enabled, /effects/preamp/gain and
//  /effects/preamp/auto-gain.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit

class PreampDataBus: DataBus {

  var state: PreampState {
    return Application.store.state.effects.preamp
  }

  var enabledChangedListener: EventListener<Bool>?
  var gainChangedListener: EventListener<Double>?
  var autoGainChangedListener: EventListener<Bool>?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/enabled") { _, _ in
      return [ "enabled": self.state.enabled ]
    }

    self.on(.POST, "/enabled") { data, _ in
      guard let enabled = data["enabled"] as? Bool else {
        throw "Invalid 'enabled' value, must be a boolean"
      }
      Application.dispatchAction(PreampAction.setEnabled(enabled))
      return "Preamp enabled state has been set"
    }

    self.on(.GET, "/gain") { _, _ in
      return [ "gain": self.state.gain ]
    }

    self.on(.POST, "/gain") { data, _ in
      let gain = data["gain"] as? Double
      let range = PreampKernelParams.gainRange
      if gain == nil || gain!.isNaN || !range.contains(gain!) {
        throw "Invalid 'gain' value, must be a number between "
          + String(range.lowerBound) + " and "
          + String(range.upperBound) + " (dB)"
      }
      Application.dispatchAction(PreampAction.setGain(gain!))
      return "Preamp gain has been set"
    }

    self.on(.GET, "/auto-gain") { _, _ in
      return [ "enabled": self.state.autoGain ]
    }

    self.on(.POST, "/auto-gain") { data, _ in
      // Accept both { enabled } (house style) and { autoGain }
      let enabled = (data["enabled"] as? Bool) ?? (data["autoGain"] as? Bool)
      if enabled == nil {
        throw "Invalid 'enabled' value, must be a boolean"
      }
      Application.dispatchAction(PreampAction.setAutoGain(enabled!))
      return "Preamp auto-gain has been set"
    }

    enabledChangedListener = Preamp.enabledChanged.on { enabled in
      self.send(to: "/enabled", data: JSON([ "enabled": enabled ]))
    }

    gainChangedListener = Preamp.gainChanged.on { gain in
      self.send(to: "/gain", data: JSON([ "gain": gain ]))
    }

    autoGainChangedListener = Preamp.autoGainChanged.on { enabled in
      self.send(to: "/auto-gain", data: JSON([ "enabled": enabled ]))
    }
  }
}
