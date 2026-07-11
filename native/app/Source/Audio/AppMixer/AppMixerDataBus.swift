//
//  AppMixerDataBus.swift
//  eqMac
//
//  Created by Nodeful on 12/07/2026.
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import EmitterKit
import SwiftyJSON

class AppMixerDataBus: DataBus {
  var clientsChangedListener: EventListener<[AppMixerClient]>?

  private var pushWorkItem: DispatchWorkItem?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/apps") { _, _ in
      return JSON(AppMixer.shared?.appsList() ?? [])
    }

    self.on(.POST, "/volume") { data, _ in
      guard let bundleId = data["bundleId"] as? String, bundleId.count > 0 else {
        throw "Invalid 'bundleId' value, must be a non-empty string"
      }

      guard
        let volume = data["volume"] as? Double,
        !volume.isNaN, volume >= 0, volume <= 1
      else {
        throw "Invalid 'volume' value, must be a number between 0 and 1"
      }

      let muted = data["muted"] as? Bool ?? false

      Application.dispatchAction(AppMixerAction.setAppVolume(bundleId, volume, muted))
      AppMixer.setAppVolume(bundleId: bundleId, volume: volume, muted: muted)

      self.schedulePush()

      return "App volume has been set"
    }

    clientsChangedListener = AppMixer.clientsChanged.on { _ in
      self.pushApps()
    }
  }

  // Debounce pushes so slider drags (~20Hz POSTs) don't flood the bridge -
  // only the settled state is broadcast to the UIs
  private func schedulePush () {
    pushWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      self?.pushApps()
    }
    pushWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(250), execute: workItem)
  }

  private func pushApps () {
    guard let mixer = AppMixer.shared else { return }
    self.send(to: "/apps", data: JSON(mixer.appsList()))
  }
}
