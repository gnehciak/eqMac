//
//  ExpertEqualizerDataBus.swift
//  eqMac
//
//  Route: /effects/equalizers/expert
//  (mounted by EqualizersDataBus via self.add("/expert", ExpertEqualizerDataBus.self))
//
//  Also mounts SpectrumDataBus at /spectrum, so the final spectrum route is
//  /effects/equalizers/expert/spectrum.
//

import Foundation
import SwiftyJSON
import EmitterKit

class ExpertEqualizerDataBus: DataBus {

  var state: ExpertEqualizerState {
    return Application.store.state.effects.equalizers.expert
  }
  var presetsChangedListener: EventListener<[ExpertEqualizerPreset]>?
  var selectedPresetChangedListener: EventListener<ExpertEqualizerPreset>?

  private static let bandTypes = BiquadFilterType.allCases.map { $0.rawValue }
  private static let bandChannels = [ "left", "right", "both" ]

  required init (route: String, bridge: Bridge) {
    super.init(
      route: route,
      bridge: bridge
    )

    self.on(.GET, "/settings/show-default-presets") { _, _ in
      return [ "show": self.state.showDefaultPresets ]
    }

    self.on(.POST, "/settings/show-default-presets") { data, _ in
      let show = data["show"] as? Bool
      if (show == nil) {
        throw "Invalid 'show' parameter. Must be a boolean."
      }

      Application.dispatchAction(ExpertEqualizerAction.setShowDefaultPresets(show!))

      return "Show Default Presets has been set"
    }

    self.on(.GET, "/presets") { _, _ in
      return JSON(ExpertEqualizer.presets.map { $0.dictionary })
    }

    self.on(.GET, "/presets/selected") { _, _ in
      let preset = ExpertEqualizer.getPreset(id: self.state.selectedPresetId)
        ?? ExpertEqualizer.getPreset(id: "flat")!
      return JSON(preset.dictionary)
    }

    self.on(.POST, "/presets") { data, _ in
      let bands = try self.getBands(data)
      let globalGain = data["globalGain"] as? Double ?? 0
      if let id = data["id"] as? String {
        // Update
        if (id != "manual" && ExpertEqualizer.defaultPresets.contains(where: { $0.id == id })) {
          throw "Default Presets aren't updatable."
        }
        ExpertEqualizer.updatePreset(id: id, bands: bands, globalGain: globalGain)
        let select = data["select"] as? Bool
        if select == true {
          let transition = data["transition"] as? Bool
          Application.dispatchAction(ExpertEqualizerAction.selectPreset(id, transition ?? false))
        }
        return "Expert Equalizer Preset has been updated"
      } else {
        // Create
        let name = data["name"] as? String
        if (name == nil) {
          throw "Invalid 'name' parameter, must be a String"
        }
        let preset = ExpertEqualizer.createPreset(name: name!, bands: bands, globalGain: globalGain)
        let select = data["select"] as? Bool
        if select == true {
          let transition = data["transition"] as? Bool
          Application.dispatchAction(ExpertEqualizerAction.selectPreset(preset.id, transition ?? false))
        }
        return JSON(preset.dictionary)
      }
    }

    self.on(.POST, "/presets/select") { data, _ in
      let preset = try self.getPreset(data)
      let transition = data["transition"] as? Bool ?? true
      Application.dispatchAction(ExpertEqualizerAction.selectPreset(preset.id, transition))
      return "Expert Equalizer Preset has been set."
    }

    self.on(.DELETE, "/presets") { data, _ in
      let preset = try self.getPreset(data)
      if (preset.isDefault) {
        throw "Default Presets aren't removable."
      }

      ExpertEqualizer.deletePreset(preset)
      Application.dispatchAction(ExpertEqualizerAction.selectPreset("flat", true))
      return "Expert Equalizer Preset has been deleted."
    }

    self.on(.GET, "/presets/export") { data, res in
      File.save(extensions: ["json"]) { file in
        if file != nil {
          let presets = JSON(ExpertEqualizer.userPresets.map { $0.dictionary })
          let json = presets.rawString()!
          do {
            try json.write(to: file!, atomically: true, encoding: .utf8)
            res.send(JSON("Exported \(presets.count) Presets"))
          } catch {
            res.error("Something went wrong")
          }
        } else {
          res.error("Cancelled")
        }
      }
      return nil
    }

    self.on(.GET, "/presets/import") { data, res in
      File.select() { file in
        if file == nil {
          res.error("No file selected")
          return
        }
        if file!.pathExtension != "json" {
          res.error("Invalid File format, must be a JSON")
          return
        }

        if let json = try? String(contentsOf: file!) {
          let presets = JSON(parseJSON: json).arrayValue
          var imported = 0
          for preset in presets {
            guard let name = preset["name"].string else { continue }
            guard let rawBands = preset["bands"].arrayObject as? [[String: Any]] else { continue }
            guard let bands = try? self.parseBands(rawBands) else { continue }
            let globalGain = preset["globalGain"].double ?? 0
            if preset["id"].string == "manual" {
              ExpertEqualizer.updatePreset(id: "manual", bands: bands, globalGain: globalGain)
            } else {
              _ = ExpertEqualizer.createPreset(name: name, bands: bands, globalGain: globalGain)
            }
            imported += 1
          }
          res.send(JSON("Imported \(imported) Presets"))
        } else {
          res.error("File is not readable format.")
        }
      }
      return nil
    }

    self.add("/spectrum", SpectrumDataBus.self)
    self.add("/autoeq", AutoEQDataBus.self)

    presetsChangedListener = ExpertEqualizer.presetsChanged.on { _ in
      self.send(to: "/presets", data: JSON(ExpertEqualizer.presets.map { $0.dictionary }))
    }

    selectedPresetChangedListener = ExpertEqualizer.selectedPresetChanged.on { preset in
      self.send(to: "/presets/selected", data: JSON(preset.dictionary))
    }
  }

  private func getPreset (_ data: JSON?) throws -> ExpertEqualizerPreset {
    if let id = data["id"] as? String {
      if let preset = ExpertEqualizer.getPreset(id: id) {
        return preset
      } else {
        throw "Could not find Preset with this ID"
      }
    } else {
      throw "Please provide a preset ID"
    }
  }

  private func getBands (_ data: JSON?) throws -> [ExpertEqualizerPresetBand] {
    guard let rawBands = data["bands"] as? [[String: Any]] else {
      throw "Invalid 'bands' parameter, must be an Array of Band objects"
    }
    return try parseBands(rawBands)
  }

  private func parseBands (_ rawBands: [[String: Any]]) throws -> [ExpertEqualizerPresetBand] {
    return try rawBands.map { try self.parseBand($0) }
  }

  private func parseBand (_ raw: [String: Any]) throws -> ExpertEqualizerPresetBand {
    guard let type = raw["type"] as? String,
          ExpertEqualizerDataBus.bandTypes.contains(type) else {
      throw "Invalid band 'type' parameter, must be one of: "
        + ExpertEqualizerDataBus.bandTypes.joined(separator: ", ")
    }
    guard let frequency = raw["frequency"] as? Double,
          (20.0 ... 20_000.0).contains(frequency) else {
      throw "Invalid band 'frequency' parameter, must be a number between 20 and 20000"
    }
    guard let gain = raw["gain"] as? Double,
          (-24.0 ... 24.0).contains(gain) else {
      throw "Invalid band 'gain' parameter, must be a number between -24.0 and 24.0"
    }
    guard let q = raw["q"] as? Double,
          (0.1 ... 10.0).contains(q) else {
      throw "Invalid band 'q' parameter, must be a number between 0.1 and 10.0"
    }
    guard let channel = raw["channel"] as? String,
          ExpertEqualizerDataBus.bandChannels.contains(channel) else {
      throw "Invalid band 'channel' parameter, must be one of: left, right, both"
    }
    let enabled = raw["enabled"] as? Bool ?? true
    let id = raw["id"] as? String ?? UUID().uuidString
    return ExpertEqualizerPresetBand(
      id: id,
      type: type,
      frequency: frequency,
      gain: gain,
      q: q,
      channel: channel,
      enabled: enabled
    )
  }
}
