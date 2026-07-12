//
//  EffectsDataBus.swift
//  eqMac
//
//  Created by Romans Kisils on 19/10/2019.
//  Copyright © 2019 Romans Kisils. All rights reserved.
//

import Foundation

class EffectsDataBus: DataBus {
  required init(route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)
    self.add("/equalizers", EqualizersDataBus.self)
    self.add("/crossfeed", CrossfeedDataBus.self)
    self.add("/delay", ChannelDelayDataBus.self)
    self.add("/routing", RoutingDataBus.self)
    self.add("/preamp", PreampDataBus.self)
    self.add("/reverb", ReverbDataBus.self)
    self.add("/audio-units", AudioUnitsDataBus.self)
  }
}
