//
//  SuperPresetsDataBus.swift
//  eqMac
//
//  Mounted by the integration wiring in ApplicationDataBus:
//
//    self.add("/super-presets", SuperPresetsDataBus.self)
//
//  Routes:
//    GET  /super-presets/enabled  -> { enabled }
//    POST /super-presets/enabled  <- { enabled }
//    GET  /super-presets/rules    -> [ rule ]
//    POST /super-presets/rules    <- rule (create when 'id' is unknown, update otherwise)
//    DELETE /super-presets/rules  <- { id }
//    GET  /super-presets/options  -> { devices: [{ uid, name }], apps: [{ bundleId, name }] }
//
//  Push events: /super-presets/rules, /super-presets/enabled
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import Cocoa
import SwiftyJSON
import EmitterKit

class SuperPresetsDataBus: DataBus {

  var state: SuperPresetsState {
    return SuperPresets.getState()
  }

  var enabledChangedListener: EventListener<Bool>?
  var rulesChangedListener: EventListener<[SuperPresetRule]>?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/enabled") { _, _ in
      return [ "enabled": self.state.enabled ]
    }

    self.on(.POST, "/enabled") { data, _ in
      guard let enabled = data["enabled"] as? Bool else {
        throw "Invalid 'enabled' parameter, must be a boolean"
      }
      Application.dispatchAction(SuperPresetsAction.setEnabled(enabled))
      return "Super Presets enabled state has been set"
    }

    self.on(.GET, "/rules") { _, _ in
      return JSON(self.state.rules.map { $0.dictionary })
    }

    self.on(.POST, "/rules") { data, _ in
      let rule = try self.parseRule(data)
      if self.state.rules.contains(where: { $0.id == rule.id }) {
        Application.dispatchAction(SuperPresetsAction.updateRule(rule))
      } else {
        Application.dispatchAction(SuperPresetsAction.addRule(rule))
      }
      return JSON(rule.dictionary)
    }

    self.on(.DELETE, "/rules") { data, _ in
      guard let id = data["id"] as? String, !id.isEmpty else {
        throw "Please provide a rule 'id'"
      }
      guard self.state.rules.contains(where: { $0.id == id }) else {
        throw "Could not find a Rule with this ID"
      }
      Application.dispatchAction(SuperPresetsAction.deleteRule(id))
      return "Super Preset Rule has been deleted"
    }

    self.on(.GET, "/options") { _, _ in
      return JSON([
        "devices": self.deviceOptions,
        "apps": self.appOptions
      ])
    }

    enabledChangedListener = SuperPresets.enabledChanged.on { enabled in
      self.send(to: "/enabled", data: JSON([ "enabled": enabled ]))
    }

    rulesChangedListener = SuperPresets.rulesChanged.on { rules in
      self.send(to: "/rules", data: JSON(rules.map { $0.dictionary }))
    }
  }

  // MARK: - Options
  private var deviceOptions: [[String: String]] {
    return Outputs.allowedDevices.compactMap { device -> [String: String]? in
      guard let uid = device.uid, !uid.isEmpty else { return nil }
      return [
        "uid": uid,
        "name": device.sourceName ?? device.name
      ]
    }
  }

  private var appOptions: [[String: String]] {
    return NSWorkspace.shared.runningApplications
      .filter { $0.activationPolicy == .regular }
      .compactMap { app -> [String: String]? in
        guard let bundleId = app.bundleIdentifier, !bundleId.isEmpty else { return nil }
        if bundleId == Application.bundleId { return nil }
        return [
          "bundleId": bundleId,
          "name": app.localizedName ?? bundleId
        ]
      }
      .sorted { ($0["name"] ?? "").lowercased() < ($1["name"] ?? "").lowercased() }
  }

  // MARK: - Validation
  private func parseRule (_ data: JSON?) throws -> SuperPresetRule {
    guard let triggerRaw = data["trigger"] as? [String: Any] else {
      throw "Invalid 'trigger' parameter, must be an object"
    }

    guard let kind = triggerRaw["kind"] as? String, SuperPresetTriggerKinds.contains(kind) else {
      throw "Invalid trigger 'kind' parameter, must be one of: "
        + SuperPresetTriggerKinds.joined(separator: ", ")
    }

    let deviceUID = triggerRaw["deviceUID"] as? String
    let bundleId = triggerRaw["bundleId"] as? String

    if kind == "device" && (deviceUID == nil || deviceUID!.isEmpty) {
      throw "Invalid 'deviceUID' parameter, must be a non-empty String for a 'device' trigger"
    }

    if kind == "app" && (bundleId == nil || bundleId!.isEmpty) {
      throw "Invalid 'bundleId' parameter, must be a non-empty String for an 'app' trigger"
    }

    guard let equalizerType = data["equalizerType"] as? String,
      SuperPresetsSupportedEqualizerTypes.contains(equalizerType) else {
      throw "Invalid 'equalizerType' parameter, must be one of: "
        + SuperPresetsSupportedEqualizerTypes.joined(separator: ", ")
    }

    guard let presetId = data["presetId"] as? String, !presetId.isEmpty else {
      throw "Invalid 'presetId' parameter, must be a non-empty String"
    }

    let revert = data["revert"] as? Bool ?? false
    let id = data["id"] as? String ?? UUID().uuidString

    return SuperPresetRule(
      id: id,
      trigger: SuperPresetTrigger(
        kind: kind,
        deviceUID: kind == "device" ? deviceUID : nil,
        bundleId: kind == "app" ? bundleId : nil
      ),
      equalizerType: equalizerType,
      presetId: presetId,
      revert: revert
    )
  }
}
