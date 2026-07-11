//
//  MIDIDataBus.swift
//  eqMac
//
//  Route: /midi
//  (mounted by ApplicationDataBus via self.add("/midi", MIDIDataBus.self))
//
//  GET    /devices  -> [ { id, name, online } ]
//  GET    /mappings -> [ { id, source: { channel, kind, number }, target } ]
//  POST   /mappings -> upsert: { id, target?, source? } updates,
//                      { target, source } creates. Replies with the mapping.
//  DELETE /mappings -> { id }
//  POST   /learn    -> { target } arms learn mode. Async: replies with the
//                      newly bound mapping once the next CC / Note On
//                      arrives (or errors on timeout / cancellation).
//  DELETE /learn    -> cancels a pending learn
//  GET    /enabled  -> { enabled }
//  POST   /enabled  -> { enabled }
//
//  Pushes: /mappings and /devices
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import EmitterKit
import SwiftyJSON

class MIDIDataBus: DataBus {
  var state: MIDIState {
    return Application.store.state.midi
  }

  var mappingsChangedListener: EventListener<[MIDIMapping]>?
  var devicesChangedListener: EventListener<[MIDIDevice]>?

  required init (route: String, bridge: Bridge) {
    super.init(
      route: route,
      bridge: bridge
    )

    self.on(.GET, "/devices") { _, _ in
      return JSON(MIDIManager.shared.devices.map { $0.dictionary })
    }

    self.on(.GET, "/mappings") { _, _ in
      return JSON(self.state.mappings.map { $0.dictionary })
    }

    self.on(.POST, "/mappings") { data, _ in
      let target = try self.getTarget(data)
      let source = try self.getSource(data)
      var mappings = self.state.mappings

      if let id = data["id"] as? String {
        // Update (in place - keeps the row position stable in the UI)
        guard let index = mappings.firstIndex(where: { $0.id == id }) else {
          throw "Could not find a MIDI Mapping with this ID"
        }
        var mapping = mappings[index]
        mapping.target = target
        if source != nil {
          mapping.source = source!
        }
        mappings[index] = mapping
        // Retargeting must not leave two mappings on the same target
        mappings.removeAll { $0.id != id && $0.target == target }
        Application.dispatchAction(MIDIAction.setMappings(mappings))
        return JSON(mapping.dictionary)
      } else {
        // Create
        guard source != nil else {
          throw "Invalid 'source' parameter, must be a JSON with 'kind' ('cc' or 'note'), 'number' (0-127) and optional 'channel' (0-15, or -1 for any)"
        }
        let mapping = MIDIMapping(id: UUID().uuidString, source: source!, target: target)
        // One mapping per target + one target per physical control
        mappings.removeAll { $0.target == target || $0.source == source! }
        mappings.append(mapping)
        Application.dispatchAction(MIDIAction.setMappings(mappings))
        return JSON(mapping.dictionary)
      }
    }

    self.on(.DELETE, "/mappings") { data, _ in
      guard let id = data["id"] as? String else {
        throw "Please provide a mapping 'id'"
      }
      var mappings = self.state.mappings
      guard mappings.contains(where: { $0.id == id }) else {
        throw "Could not find a MIDI Mapping with this ID"
      }
      mappings.removeAll { $0.id == id }
      Application.dispatchAction(MIDIAction.setMappings(mappings))
      return "MIDI Mapping has been removed"
    }

    self.on(.POST, "/learn") { data, res in
      let target = try self.getTarget(data)
      MIDIManager.shared.armLearn(target: target) { mapping, error in
        // Completion arrives on the MIDI serial queue - the Bridge must be
        // driven from the main thread
        DispatchQueue.main.async {
          if mapping != nil {
            res.send(JSON(mapping!.dictionary))
          } else {
            res.error(error ?? "MIDI Learn failed")
          }
        }
      }
      return nil
    }

    self.on(.DELETE, "/learn") { _, _ in
      MIDIManager.shared.cancelLearn()
      return "MIDI Learn has been cancelled"
    }

    self.on(.GET, "/enabled") { _, _ in
      return [ "enabled": self.state.enabled ]
    }

    self.on(.POST, "/enabled") { data, _ in
      guard let enabled = data["enabled"] as? Bool else {
        throw "Invalid 'enabled' parameter, must be a boolean"
      }
      Application.dispatchAction(MIDIAction.setEnabled(enabled))
      return "MIDI has been " + (enabled ? "enabled" : "disabled")
    }

    mappingsChangedListener = MIDIManager.mappingsChanged.on { mappings in
      self.send(to: "/mappings", data: JSON(mappings.map { $0.dictionary }))
    }

    devicesChangedListener = MIDIManager.devicesChanged.on { devices in
      self.send(to: "/devices", data: JSON(devices.map { $0.dictionary }))
    }
  }

  private func getTarget (_ data: JSON?) throws -> MIDIMappingTarget {
    if let targetRaw = data["target"] as? String {
      if let target = MIDIMappingTarget(rawValue: targetRaw) {
        return target
      }
    }
    throw "Invalid 'target' parameter, must be one of: "
      + MIDIMappingTarget.allCases.map { $0.rawValue }.joined(separator: ", ")
  }

  private func getSource (_ data: JSON?) throws -> MIDIMappingSource? {
    guard let source = data["source"] as? [String: Any] else {
      return nil
    }
    guard let kindRaw = source["kind"] as? String,
          let kind = MIDISourceKind(rawValue: kindRaw) else {
      throw "Invalid 'source.kind' parameter, must be 'cc' or 'note'"
    }
    guard let number = source["number"] as? Int, (0 ... 127).contains(number) else {
      throw "Invalid 'source.number' parameter, must be an integer between 0 and 127"
    }
    let channel = source["channel"] as? Int ?? -1
    guard (-1 ... 15).contains(channel) else {
      throw "Invalid 'source.channel' parameter, must be an integer between 0 and 15, or -1 for any channel"
    }
    return MIDIMappingSource(channel: channel, kind: kind, number: number)
  }
}
