//
//  SpectrumDataBus.swift
//  eqMac
//
//  Route: /effects/equalizers/expert/spectrum
//  (mounted by ExpertEqualizerDataBus via self.add("/spectrum", SpectrumDataBus.self))
//
//  Spectrum frames are pushed to the bare route ('') as
//  { bins: [Double], sampleRate: Double } - ONLY while a UI subscriber has
//  POSTed /enabled { enabled: true }. Frames never touch the ReSwift store.
//

import Foundation
import SwiftyJSON

class SpectrumDataBus: DataBus {

  required init (route: String, bridge: Bridge) {
    super.init(
      route: route,
      bridge: bridge
    )

    self.on(.GET, "/enabled") { _, _ in
      return [ "enabled": SpectrumAnalyzer.shared.enabled ]
    }

    self.on(.POST, "/enabled") { data, _ in
      let enabled = data["enabled"] as? Bool
      if (enabled == nil) {
        throw "Invalid 'enabled' parameter. Must be a boolean."
      }

      SpectrumAnalyzer.shared.setEnabled(enabled!)

      return JSON("Spectrum Analyzer has been " + (enabled! ? "enabled" : "disabled"))
    }

    SpectrumAnalyzer.shared.frameHandler = { [weak self] bins, sampleRate in
      // The analysis timer runs on a utility queue - hop to main for the
      // WebViewJavascriptBridge push
      DispatchQueue.main.async {
        self?.send(to: "", data: JSON([
          "bins": bins,
          "sampleRate": sampleRate
        ]))
      }
    }
  }
}
