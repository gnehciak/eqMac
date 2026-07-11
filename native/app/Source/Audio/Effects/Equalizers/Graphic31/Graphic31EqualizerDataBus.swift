//
//  Graphic31EqualizerDataBus.swift
//  eqMac
//
//  Mechanical clone of AdvancedEqualizerDataBus for the 31 Band Graphic Equalizer.
//  Mounted by EqualizersDataBus at '/graphic31'.
//

import Foundation
import SwiftyJSON
import EmitterKit

class Graphic31EqualizerDataBus: DataBus {

  var state: Graphic31EqualizerState {
    return Application.store.state.effects.equalizers.graphic31
  }
  var presetsChangedListener: EventListener<[Graphic31EqualizerPreset]>?

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

      Application.dispatchAction(Graphic31EqualizerAction.setShowDefaultPresets(show!))

      return "Show Default Presets has been set"
    }

    self.on(.GET, "/presets") { _, _ in
      return JSON(Graphic31Equalizer.presets.map { $0.dictionary })
    }

    self.on(.GET, "/presets/selected") { _, _ in
      let preset = Graphic31Equalizer.getPreset(id: self.state.selectedPresetId)
        ?? Graphic31Equalizer.getPreset(id: "flat")!
      return JSON(preset.dictionary)
    }

    self.on(.POST, "/presets") { data, _ in
      let gains = try self.getGains(data)
      if let id = data["id"] as? String {
        // Update
        if (id != "manual"), let existing = Graphic31Equalizer.getPreset(id: id), existing.isDefault {
          throw "Default Presets aren't updatable."
        }
        Graphic31Equalizer.updatePreset(id: id, gains: gains)
        let select = data["select"] as? Bool
        if select == true {
          let transition = data["transition"] as? Bool
          Application.dispatchAction(Graphic31EqualizerAction.selectPreset(id, transition ?? false))
        }
        return "Graphic 31 Equalizer Preset has been updated"
      } else {
        // Create
        let name = data["name"] as? String
        if (name == nil) {
          throw "Invalid 'name' parameter, must be a String"
        }
        let preset = Graphic31Equalizer.createPreset(name: name!, gains: gains)
        let select = data["select"] as? Bool
        if select == true {
          let transition = data["transition"] as? Bool
          Application.dispatchAction(Graphic31EqualizerAction.selectPreset(preset.id, transition ?? false))
        }
        return JSON(preset.dictionary)
      }

    }

    self.on(.POST, "/presets/select") { data, _ in
      let preset = try self.getPreset(data)
      Application.dispatchAction(Graphic31EqualizerAction.selectPreset(preset.id, true))
      return "Graphic 31 Equalizer Preset has been set."
    }

    self.on(.DELETE, "/presets") { data, _ in
      let preset = try self.getPreset(data)
      if (preset.isDefault) {
        throw "Default Presets aren't removable."
      }

      Graphic31Equalizer.deletePreset(preset)
      Application.dispatchAction(Graphic31EqualizerAction.selectPreset("flat", true))
      return "Graphic 31 Equalizer Preset has been deleted."

    }

    self.on(.GET, "/presets/export") { data, res in
      File.save(extensions: ["json"]) { file in
        if file != nil {
          let presets = JSON(Graphic31Equalizer.userPresets.map { $0.dictionary })
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
            if let gains = preset["gains"].dictionary, let name = preset["name"].string {
              let global = gains["global"]?.double
              if let bands = gains["bands"]?.arrayObject as? [Double] {
                if bands.count != Graphic31Equalizer.frequencies.count {
                  continue
                }
                if bands.first(where: { !(-24.0...24.0).contains($0) }) != nil {
                  continue
                }
                if !(-24.0...24.0).contains(global ?? 0) {
                  continue
                }
                if preset["id"].string == "manual" {
                  Graphic31Equalizer.updatePreset(id: "manual", gains: Graphic31EqualizerPresetGains(
                    global: global ?? 0, bands: bands
                  ))
                } else {
                  _ = Graphic31Equalizer.createPreset(name: name, gains: Graphic31EqualizerPresetGains(
                    global: global ?? 0, bands: bands
                  ))
                }
                imported += 1
              }
            }
          }
          res.send(JSON("Imported \(imported) Presets"))
        } else {
          res.error("File is not readable format.")
        }

      }
      return nil
    }

    presetsChangedListener = Graphic31Equalizer.presetsChanged.on { presets in
      self.send(to: "/presets", data: JSON(Graphic31Equalizer.presets.map { $0.dictionary }))
    }

  }

  private func getPreset (_ data: JSON?) throws -> Graphic31EqualizerPreset {
    if let id = data["id"] as? String {
      if let preset = Graphic31Equalizer.getPreset(id: id) {
        return preset
      } else {
        throw "Could not find Preset with this ID"
      }
    } else {
      throw "Please provide a preset ID"
    }
  }

  private func getGains (_ data: JSON?) throws -> Graphic31EqualizerPresetGains {
    if let gains = data["gains"] as? [String: Any] {
      if let bands = gains["bands"] as? [Double], let global = gains["global"] as? Double {
        let length = Graphic31Equalizer.frequencies.count
        if bands.count != length {
          throw "Invalid length of 'gains' parameter, must equal to " + String(length)
        }
        if bands.first(where: { !(-24.0...24.0).contains($0) }) != nil {
          throw "Invalid value in 'gains' parameter, must between -24.0 and 24.0"
        }
        if !(-24.0...24.0).contains(global) {
          throw "Invalid 'global' gain value, must between -24.0 and 24.0"
        }
        return Graphic31EqualizerPresetGains(global: global, bands: bands)
      }
    }
    throw "Invalid 'gains' parameter, must be a JSON with 'bands' Double Array and 'global' Double"
  }
}
