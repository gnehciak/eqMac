//
//  BackupDataBus.swift
//  eqMac
//
//  Created by Romans Kisils on 12/07/2026.
//  Copyright © 2026 Romans Kisils. All rights reserved.
//

import Foundation
import SwiftyJSON

// Whole-configuration Backup / Restore.
// Serializes the persisted ApplicationState + every preset collection into a
// single portable .eqmacbackup JSON file, and restores them back.
//
// UserDefaults is accessed by the same key strings that Helpers/Storage.swift
// (and the per-package `extension DefaultsKeys` declarations) use, on purpose:
// preset collections owned by other packages (Expert / Graphic 31 EQ) may not
// exist in every build, so everything is read and written defensively -
// a missing or unparsable collection never fails the whole backup.
class BackupDataBus: DataBus {

  static let BACKUP_VERSION = 1
  static let FILE_EXTENSION = "eqmacbackup"

  // Helpers/Storage.swift -> DefaultsKey<ApplicationState?>("state")
  static let STATE_STORAGE_KEY = "state"

  // backupKey - field name inside the .eqmacbackup JSON
  // storageKey - UserDefaults key the collection is persisted under
  static let PRESET_KEYS: [(backupKey: String, storageKey: String)] = [
    ("basicPresets", "basicEqualizerPresets"),
    ("advancedPresets", "advancedEqualizerPresets"),
    ("expertPresets", "expertEqualizerPresets"),
    ("graphic31Presets", "graphic31EqualizerPresets")
  ]

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/export") { _, res in
      File.save(extensions: [BackupDataBus.FILE_EXTENSION]) { file in
        if file == nil {
          res.error("Cancelled")
          return
        }

        var backup: JSON = [
          "version": BackupDataBus.BACKUP_VERSION,
          "appVersion": Application.version
        ]

        // Persisted ApplicationState - read back the raw JSON the root reducer
        // stored (Storage[.state]) instead of re-encoding the live store,
        // so the backup always matches what a fresh launch would load.
        if let stateData = UserDefaults.standard.data(forKey: BackupDataBus.STATE_STORAGE_KEY),
          let state = try? JSON(data: stateData),
          state.dictionary != nil {
          backup["state"] = state
        }

        for (backupKey, storageKey) in BackupDataBus.PRESET_KEYS {
          if let presetsData = UserDefaults.standard.data(forKey: storageKey),
            let presets = try? JSON(data: presetsData),
            presets.array != nil {
            backup[backupKey] = presets
          }
        }

        guard let json = backup.rawString() else {
          res.error("Something went wrong")
          return
        }

        do {
          try json.write(to: file!, atomically: true, encoding: .utf8)
          res.send(JSON("Backup has been saved"))
        } catch {
          res.error("Something went wrong")
        }
      }
      return nil
    }

    self.on(.GET, "/import") { _, res in
      File.select() { file in
        if file == nil {
          res.error("No file selected")
          return
        }
        let ext = file!.pathExtension
        if ext != BackupDataBus.FILE_EXTENSION && ext != "json" {
          res.error("Invalid File format, must be a .\(BackupDataBus.FILE_EXTENSION) file")
          return
        }

        guard let raw = try? String(contentsOf: file!) else {
          res.error("File is not readable format.")
          return
        }

        let backup = JSON(parseJSON: raw)
        guard backup.dictionary != nil, let version = backup["version"].int else {
          res.error("File is not a valid eqMac Backup")
          return
        }
        if version != BackupDataBus.BACKUP_VERSION {
          res.error("Unsupported Backup version: \(version)")
          return
        }

        var restored: [String] = []

        for (backupKey, storageKey) in BackupDataBus.PRESET_KEYS {
          let presets = backup[backupKey]
          guard presets.array != nil, let presetsData = try? presets.rawData() else {
            continue
          }
          // The Basic / Advanced collections are decodable in this file,
          // so sanity check them before overwriting the stored ones -
          // an unreadable array would wipe the user's presets on next read.
          // Expert / Graphic 31 types live in other packages, hence written
          // by key name only.
          if storageKey == "basicEqualizerPresets" {
            guard (try? JSONDecoder().decode([BasicEqualizerPreset].self, from: presetsData)) != nil else {
              continue
            }
          }
          if storageKey == "advancedEqualizerPresets" {
            guard (try? JSONDecoder().decode([AdvancedEqualizerPreset].self, from: presetsData)) != nil else {
              continue
            }
          }
          UserDefaults.standard.set(presetsData, forKey: storageKey)
          restored.append(backupKey)
        }

        let state = backup["state"]
        if state.dictionary != nil, let stateData = try? state.rawData() {
          // Only overwrite the stored state if ApplicationState can actually
          // decode it, otherwise the next launch would silently fall back to
          // a completely fresh state.
          if (try? JSONDecoder().decode(ApplicationState.self, from: stateData)) != nil {
            UserDefaults.standard.set(stateData, forKey: BackupDataBus.STATE_STORAGE_KEY)
            restored.append("state")
          }
        }

        if restored.count == 0 {
          res.error("Backup file contains no restorable data")
          return
        }

        Storage.synchronize()
        res.send(JSON("Backup has been restored"))

        Alert.confirm(
          title: "Backup Restored",
          message: "eqMac needs to restart to apply the restored configuration. Restart now?",
          okText: "Restart Now",
          cancelText: "Later"
        ) { confirmed in
          if confirmed {
            Application.restart()
          }
        }
      }
      return nil
    }
  }
}
