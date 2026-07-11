//
//  RecorderDataBus.swift
//  eqMac
//
//  Route: /recorder (mounted by ApplicationDataBus via
//  self.add("/recorder", RecorderDataBus.self))
//
//  POST /start                -> { recording, seconds, path }
//  POST /stop                 -> { path } (final segment, async)
//  GET  /status               -> { recording, seconds, path }
//  GET  /destination          -> { path, isDefault }
//  POST /destination          -> opens the native folder panel, returns
//                                { path, isDefault } with the chosen folder
//  DELETE /destination        -> resets to the default folder
//  POST /reveal { path }      -> reveals the file in Finder
//
//  While recording, { recording, seconds, path } is pushed to /status at
//  1Hz (plus once on every start / stop transition).
//

import Foundation
import AppKit
import SwiftyJSON

class RecorderDataBus: DataBus {

  var state: RecorderState {
    return Application.store.state.recorder
  }

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.POST, "/start") { _, _ in
      let recorder = try self.getRecorder()
      try recorder.start()
      return RecorderDataBus.statusJSON(recorder.status)
    }

    self.on(.POST, "/stop") { _, res in
      let recorder = try self.getRecorder()
      guard recorder.isRecording else {
        throw "Not recording"
      }
      recorder.stop { path in
        var resp: [String: Any] = [:]
        resp["path"] = path ?? NSNull()
        res.send(JSON(resp))
      }
      return nil
    }

    self.on(.GET, "/status") { _, _ in
      let recorder = try self.getRecorder()
      return RecorderDataBus.statusJSON(recorder.status)
    }

    self.on(.GET, "/destination") { _, _ in
      return self.destinationJSON()
    }

    self.on(.POST, "/destination") { _, res in
      File.selectDirectory { url in
        if let url = url {
          Application.dispatchAction(RecorderAction.setDestinationFolder(url.path))
          // The dispatch above lands on the main queue asynchronously -
          // answer with the chosen folder directly so the UI never reads
          // a stale value
          res.send(JSON([
            "path": url.path,
            "isDefault": false
          ]))
        } else {
          // Cancelled - current destination is unchanged
          res.send(self.destinationJSON())
        }
      }
      return nil
    }

    self.on(.DELETE, "/destination") { _, _ in
      Application.dispatchAction(RecorderAction.setDestinationFolder(nil))
      return [
        "path": Recorder.defaultDestination.path,
        "isDefault": true
      ]
    }

    self.on(.POST, "/reveal") { data, _ in
      guard let path = data["path"] as? String, path != "" else {
        throw "Please provide a valid 'path' parameter."
      }
      let url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: url.path) else {
        throw "This recording doesn't exist anymore"
      }
      NSWorkspace.shared.activateFileViewerSelecting([ url ])
      return [ "revealed": true ]
    }

    // Status pushes: start / stop transitions + 1Hz while recording.
    // The Recorder fires this from its utility drain queue - hop to main
    // for the Bridge.
    Application.recorder?.statusHandler = { [weak self] recorderStatus in
      DispatchQueue.main.async {
        self?.send(to: "/status", data: RecorderDataBus.statusJSON(recorderStatus))
      }
    }
  }

  private func getRecorder () throws -> Recorder {
    guard let recorder = Application.recorder else {
      throw "Recorder is not available yet. Please try again in a moment."
    }
    return recorder
  }

  private func destinationJSON () -> JSON {
    let custom = state.destinationFolder
    let path = (custom != nil && custom != "")
      ? custom!
      : Recorder.defaultDestination.path
    return JSON([
      "path": path,
      "isDefault": custom == nil || custom == ""
    ])
  }

  private static func statusJSON (_ status: RecorderStatus) -> JSON {
    var dict: [String: Any] = [
      "recording": status.recording,
      "seconds": status.seconds
    ]
    dict["path"] = status.path ?? NSNull()
    return JSON(dict)
  }
}

// MARK: - Folder selection

// The existing File.select helper is file-only (its NSOpenPanel extension
// hard-sets canChooseDirectories = false), so the Recorder adds a sibling
// directory picker on the same helper. A dedicated panel instance is used
// so reconfiguring it never leaks into File.select / File.save.
extension File {
  static let directoryPanel = NSOpenPanel()

  static func selectDirectory (_ callback: @escaping (URL?) -> Void) {
    DispatchQueue.main.async {
      let panel = File.directoryPanel
      panel.title = "Select Folder"
      panel.prompt = "Select"
      panel.allowsMultipleSelection = false
      panel.canChooseDirectories = true
      panel.canChooseFiles = false
      panel.canCreateDirectories = true
      panel.begin { response in
        callback(response == .OK ? panel.url : nil)
      }
    }
  }
}
