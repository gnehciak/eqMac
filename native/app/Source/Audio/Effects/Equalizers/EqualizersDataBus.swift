//
//  EqualizersDataBus.swift
//  eqMac
//
//  Created by Romans Kisils on 24/04/2019.
//  Copyright © 2019 Romans Kisils. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit

class EqualizersDataBus: DataBus {
  var state: EqualizersState {
    return Application.store.state.effects.equalizers
  }
  
  var typeChangedListener: EventListener<EqualizerType>?

  required init(route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)
    
    self.on(.GET, "/enabled") { _, _ in
      return [ "enabled": self.state.enabled ]
    }
    
    self.on(.POST, "/enabled") { data, _ in
      let enabled = data["enabled"] as? Bool
      if (enabled == nil) {
        throw "Invalid 'enabled' value, must be a valid Boolean value"
      }
      Application.dispatchAction(EqualizersAction.setEnabled(enabled!))
      return "Enabled state has been set"
    }
    
    self.on(.GET, "/type") { _, _ in
      return ["type": self.state.type.rawValue]
    }
    
    self.on(.POST, "/type") { data, _ in
      let type = data["type"] as? String
      if (type == nil) {
        throw "Please provide a 'type' parameter"
      }
      if AllEqualizerTypes.contains(type!) {
        var eqType: EqualizerType = .basic
        if (type == EqualizerType.advanced.rawValue) {
          eqType = .advanced
        } else if (type == EqualizerType.expert.rawValue) {
          eqType = .expert
        } else if (type == EqualizerType.graphic31.rawValue) {
          eqType = .graphic31
        }

        Application.dispatchAction(EqualizersAction.setType(eqType))
        return "Equalizer Type has been set"
      } else {
        throw "Invalid Equalizer Type"
      }
    }
    
    self.add("/basic", BasicEqualizerDataBus.self)
    self.add("/advanced", AdvancedEqualizerDataBus.self)
    self.add("/expert", ExpertEqualizerDataBus.self)
    self.add("/graphic31", Graphic31EqualizerDataBus.self)

    typeChangedListener = Equalizers.typeChanged.on { type in
      self.send(to: "/type", data: [ "type": type.rawValue ])
    }
  }
}
