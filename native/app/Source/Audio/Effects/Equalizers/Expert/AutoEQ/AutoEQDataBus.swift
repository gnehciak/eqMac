//
//  AutoEQDataBus.swift
//  eqMac
//
//  Route: /effects/equalizers/expert/autoeq
//  (mounted by ExpertEqualizerDataBus via self.add("/autoeq", AutoEQDataBus.self))
//
//  Both routes are async (nil return + res.send) because the first request
//  lazily gunzips + decodes the bundled database on a background utility
//  queue. AutoEQ delivers all completions on the main queue, so preset
//  mutations, action dispatches and bridge sends below stay main-thread.
//

import Foundation
import SwiftyJSON

class AutoEQDataBus: DataBus {

  required init (route: String, bridge: Bridge) {
    super.init(
      route: route,
      bridge: bridge
    )

    self.on(.GET, "/search") { data, res in
      let query = data["q"] as? String ?? ""
      AutoEQ.search(query: query) { results, total in
        guard let results = results else {
          res.error("AutoEQ database could not be loaded")
          return
        }
        res.send(JSON([
          "results": results.map { $0.dictionary },
          "total": total
        ]))
      }
      return nil
    }

    self.on(.POST, "/apply") { data, res in
      let id = try self.getId(data)
      let name = data["name"] as? String
      let saveAsPreset = data["saveAsPreset"] as? Bool ?? false

      AutoEQ.get(id: id) { preset in
        guard let preset = preset else {
          res.error("Could not find an AutoEQ entry with this ID")
          return
        }

        if (saveAsPreset) {
          // Persist as a brand new user preset and select it
          let created = ExpertEqualizer.createPreset(
            name: name ?? preset.name,
            bands: preset.bands,
            globalGain: preset.globalGain
          )
          Application.dispatchAction(ExpertEqualizerAction.selectPreset(created.id, true))
          res.send(JSON(created.dictionary))
        } else {
          // Audition via the house 'manual' preset contract
          ExpertEqualizer.updatePreset(
            id: "manual",
            bands: preset.bands,
            globalGain: preset.globalGain
          )
          Application.dispatchAction(ExpertEqualizerAction.selectPreset("manual", true))
          res.send(JSON("Applied '\(preset.name)' to the Manual preset"))
        }
      }
      return nil
    }
  }

  private func getId (_ data: JSON?) throws -> String {
    if let id = data["id"] as? String {
      return id
    }
    // Tolerate a numeric id (the canonical ids are stringified indices)
    if let id = data["id"] as? Int {
      return String(id)
    }
    throw "Please provide a valid AutoEQ entry 'id'"
  }
}
