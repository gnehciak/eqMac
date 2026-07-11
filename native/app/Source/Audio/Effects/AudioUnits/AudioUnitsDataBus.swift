//
//  AudioUnitsDataBus.swift
//  eqMac
//
//  Mounted by the integration wiring in EffectsDataBus:
//
//    self.add("/audio-units", AudioUnitsDataBus.self)
//
//  giving the routes:
//
//    GET  /effects/audio-units/available
//    GET  /effects/audio-units/chain
//    POST /effects/audio-units/chain/add     { componentType, componentSubType, componentManufacturer }
//    POST /effects/audio-units/chain/remove  { id }
//    POST /effects/audio-units/chain/move    { id, index }
//    POST /effects/audio-units/chain/enabled { id, enabled }
//    POST /effects/audio-units/editor/open   { id }
//
//  /chain is pushed on every chain change.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit
import Shared

class AudioUnitsDataBus: DataBus {

  var chainChangedListener: EventListener<Void>?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/available") { _, _ in
      let available = AudioUnitsHost.availableComponents().map { component -> [String: Any] in
        let description = component.audioComponentDescription
        return [
          "name": component.name,
          "manufacturerName": component.manufacturerName,
          "version": component.versionString,
          "componentType": description.componentType,
          "componentSubType": description.componentSubType,
          "componentManufacturer": description.componentManufacturer,
          "hasCustomView": component.hasCustomView
        ]
      }
      return JSON(available)
    }

    self.on(.GET, "/chain") { _, _ in
      return JSON(self.chainJSON())
    }

    self.on(.POST, "/chain/add") { data, _ in
      let host = try self.getHost()
      let componentType = try self.getUInt32(data, "componentType")
      let componentSubType = try self.getUInt32(data, "componentSubType")
      let componentManufacturer = try self.getUInt32(data, "componentManufacturer")

      try host.add(
        componentType: componentType,
        componentSubType: componentSubType,
        componentManufacturer: componentManufacturer
      )
      return "Audio Unit is being added to the chain"
    }

    self.on(.POST, "/chain/remove") { data, _ in
      let host = try self.getHost()
      let id = try self.getId(data)
      try host.remove(id: id)
      return "Audio Unit has been removed from the chain"
    }

    self.on(.POST, "/chain/move") { data, _ in
      let host = try self.getHost()
      let id = try self.getId(data)
      guard let index = self.getInt(data, "index") else {
        throw "Invalid 'index' parameter, must be an Integer"
      }
      try host.move(id: id, to: index)
      return "Audio Unit has been moved"
    }

    self.on(.POST, "/chain/enabled") { data, _ in
      let host = try self.getHost()
      let id = try self.getId(data)
      guard let enabled = data["enabled"] as? Bool else {
        throw "Invalid 'enabled' value, must be a valid Boolean value"
      }
      try host.setEnabled(id: id, enabled: enabled)
      return "Audio Unit enabled state has been set"
    }

    self.on(.POST, "/editor/open") { data, _ in
      let host = try self.getHost()
      let id = try self.getId(data)
      try host.openEditor(id: id)
      return "Audio Unit editor has been opened"
    }

    chainChangedListener = AudioUnitsHost.chainChanged.on {
      self.send(to: "/chain", data: JSON(self.chainJSON()))
    }
  }

  // MARK: - Helpers
  private func chainJSON () -> [[String: Any]] {
    guard let host = AudioUnitsHost.shared else { return [] }
    return host.units.map { unit in
      return [
        "id": unit.id,
        "name": unit.name,
        "manufacturerName": unit.manufacturerName,
        "enabled": unit.enabled,
        "hasCustomView": unit.hasCustomView,
        "status": unit.status,
        "componentType": unit.componentDescription.componentType,
        "componentSubType": unit.componentDescription.componentSubType,
        "componentManufacturer": unit.componentDescription.componentManufacturer
      ]
    }
  }

  private func getHost () throws -> AudioUnitsHost {
    guard let host = AudioUnitsHost.shared else {
      throw "Audio Units host is not available"
    }
    return host
  }

  private func getId (_ data: JSON?) throws -> String {
    guard let id = data["id"] as? String else {
      throw "Please provide an 'id' parameter"
    }
    return id
  }

  private func getInt (_ data: JSON?, _ key: String) -> Int? {
    if let value = data[key] as? Int {
      return value
    }
    if let value = data[key] as? Double, let intValue = Int(exactly: value.rounded()) {
      return intValue
    }
    return nil
  }

  private func getUInt32 (_ data: JSON?, _ key: String) throws -> UInt32 {
    if let value = data[key] as? Double, let uint32Value = UInt32(exactly: value.rounded()) {
      return uint32Value
    }
    if let value = data[key] as? Int, let uint32Value = UInt32(exactly: value) {
      return uint32Value
    }
    throw "Invalid '\(key)' parameter, must be an unsigned 32 bit Integer"
  }
}
