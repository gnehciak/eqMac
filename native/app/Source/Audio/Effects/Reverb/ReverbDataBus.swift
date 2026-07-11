//
//  ReverbDataBus.swift
//  eqMac
//
//  Mounted by the integration wiring in EffectsDataBus:
//
//    self.add("/reverb", ReverbDataBus.self)
//
//  giving the routes /effects/reverb/enabled, /effects/reverb/environment
//  and /effects/reverb/wet-dry-mix.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit

class ReverbDataBus: DataBus {

  var state: ReverbState {
    return Application.store.state.effects.reverb
  }

  var enabledChangedListener: EventListener<Bool>?
  var environmentChangedListener: EventListener<ReverbEnvironment>?
  var wetDryMixChangedListener: EventListener<Double>?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/enabled") { _, _ in
      return [ "enabled": self.state.enabled ]
    }

    self.on(.POST, "/enabled") { data, _ in
      guard let enabled = data["enabled"] as? Bool else {
        throw "Invalid 'enabled' value, must be a boolean"
      }
      Application.dispatchAction(ReverbAction.setEnabled(enabled))
      return "Reverb enabled state has been set"
    }

    self.on(.GET, "/environment") { _, _ in
      return [ "environment": self.state.environment ]
    }

    self.on(.POST, "/environment") { data, _ in
      guard let environment = data["environment"] as? String else {
        throw "Please provide an 'environment' value"
      }
      guard let reverbEnvironment = ReverbEnvironment(rawValue: environment) else {
        throw "Invalid 'environment' value, must be one of: "
          + AllReverbEnvironments.joined(separator: ", ")
      }
      Application.dispatchAction(ReverbAction.setEnvironment(reverbEnvironment))
      return "Reverb environment has been set"
    }

    self.on(.GET, "/wet-dry-mix") { _, _ in
      return [ "wetDryMix": self.state.wetDryMix ]
    }

    self.on(.POST, "/wet-dry-mix") { data, _ in
      guard let wetDryMix = data["wetDryMix"] as? Double, !wetDryMix.isNaN else {
        throw "Please provide a 'wetDryMix' value, must be a number between "
          + String(Reverb.wetDryMixRange.lowerBound) + " and "
          + String(Reverb.wetDryMixRange.upperBound)
      }
      if !Reverb.wetDryMixRange.contains(wetDryMix) {
        throw "Invalid 'wetDryMix' value, must be a number between "
          + String(Reverb.wetDryMixRange.lowerBound) + " and "
          + String(Reverb.wetDryMixRange.upperBound)
      }
      Application.dispatchAction(ReverbAction.setWetDryMix(wetDryMix))
      return "Reverb Wet / Dry mix has been set"
    }

    enabledChangedListener = Reverb.enabledChanged.on { enabled in
      self.send(to: "/enabled", data: JSON([ "enabled": enabled ]))
    }

    environmentChangedListener = Reverb.environmentChanged.on { environment in
      self.send(to: "/environment", data: JSON([ "environment": environment.rawValue ]))
    }

    wetDryMixChangedListener = Reverb.wetDryMixChanged.on { wetDryMix in
      self.send(to: "/wet-dry-mix", data: JSON([ "wetDryMix": wetDryMix ]))
    }
  }
}
