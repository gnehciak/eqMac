//
//  AppMixer.swift
//  eqMac
//
//  Created by Nodeful on 12/07/2026.
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import AppKit
import CoreAudio
import AMCoreAudio
import EmitterKit
import Shared

struct AppMixerClient {
  let processId: pid_t
  let bundleId: String?
  let volume: Double
  let muted: Bool
}

// Facade over the driver's App Mixer custom properties
// ('clts' - client list, 'apvl' - per-app volumes), following the
// Driver.swift accessor style. An instance is created by Application
// setup - it listens for driver client changes, reapplies persisted
// volumes on launch and on client (re)connect and emits clientsChanged.
class AppMixer {
  // Wired by Application setup so this class can read the persisted
  // App Mixer state without hard-coupling to ApplicationState:
  //   AppMixer.getState = { Application.store.state.appMixer }
  static var getState: () -> AppMixerState = { AppMixerState() }

  static var shared: AppMixer?

  // MARK: - Events
  static let clientsChanged = EmitterKit.Event<[AppMixerClient]>()

  // Internal mirror of the persisted volumes - kept in sync by
  // setVolume() so the runtime works even before store wiring lands
  private var volumes: [String: AppVolume] = [:]

  private var clientsListenerBlock: AudioObjectPropertyListenerBlock?
  private var listeningDeviceId: AudioObjectID?
  private var knownClientKeys: Set<String> = []
  private var setupRetries = 0

  // MARK: - Initialization
  init () {
    Console.log("Creating AppMixer")
    AppMixer.shared = self
    volumes = AppMixer.getState().volumes
    setup()
  }

  private func setup () {
    guard let device = Driver.device else {
      // Driver device is not available yet - retry shortly
      setupRetries += 1
      if setupRetries <= 10 {
        Async.delay(1000) { [weak self] in
          self?.setup()
        }
      }
      return
    }

    installClientsListener(deviceId: device.id)
    applyStoredVolumes()
    knownClientKeys = Set(AppMixer.getClients().map { AppMixer.clientKey($0) })
  }

  private func installClientsListener (deviceId: AudioObjectID) {
    let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
      self?.clientsDidChange()
    }
    clientsListenerBlock = block
    listeningDeviceId = deviceId
    AudioObjectAddPropertyListenerBlock(
      deviceId,
      &EQMDeviceCustom.addresses.clients,
      DispatchQueue.main,
      block
    )
  }

  private func clientsDidChange () {
    let clients = AppMixer.getClients()
    let keys = Set(clients.map { AppMixer.clientKey($0) })

    // Only reapply stored volumes when the client membership actually
    // changed - volume-only updates fire this notification as well and
    // reapplying on those would create a feedback loop
    if keys != knownClientKeys {
      knownClientKeys = keys
      applyStoredVolumes()
      AppMixer.clientsChanged.emit(clients)
    }
  }

  private static func clientKey (_ client: AppMixerClient) -> String {
    return "\(client.processId):\(client.bundleId ?? "")"
  }

  // MARK: - Volumes
  func applyStoredVolumes () {
    volumes = AppMixer.getState().volumes
    guard volumes.count > 0 else { return }
    AppMixer.setAppVolumes(volumes)
  }

  func setVolume (bundleId: String, volume: Double, muted: Bool) {
    let appVolume = AppVolume(volume: volume, muted: muted)
    volumes[bundleId] = appVolume
    AppMixer.setAppVolumes([ bundleId: appVolume ])
  }

  // Merged view for the UI - one row per app (deduped by bundleId),
  // enriched with a friendly name + icon via NSRunningApplication
  func appsList () -> [[String: Any]] {
    let clients = AppMixer.getClients()
    var rows: [[String: Any]] = []
    var seenBundleIds = Set<String>()

    for client in clients {
      // Never expose eqMac itself in the mixer
      if client.bundleId == APP_BUNDLE_ID { continue }

      if let bundleId = client.bundleId {
        if seenBundleIds.contains(bundleId) { continue }
        seenBundleIds.insert(bundleId)
      }

      let saved = client.bundleId != nil ? volumes[client.bundleId!] : nil

      var row: [String: Any] = [
        "pid": Int(client.processId),
        "volume": saved?.volume ?? client.volume,
        "muted": saved?.muted ?? client.muted
      ]
      if let bundleId = client.bundleId {
        row["bundleId"] = bundleId
      }

      let runningApp = AppMixer.runningApplication(
        processId: client.processId,
        bundleId: client.bundleId
      )
      if let name = runningApp?.localizedName {
        row["name"] = name
      } else if let bundleId = client.bundleId {
        row["name"] = bundleId.components(separatedBy: ".").last ?? bundleId
      } else {
        row["name"] = "PID \(client.processId)"
      }

      if let icon = runningApp?.icon?.resize(with: NSSize(width: 32, height: 32)).base64String {
        row["icon"] = icon
      }

      rows.append(row)
    }

    return rows.sorted {
      ($0["name"] as? String ?? "") < ($1["name"] as? String ?? "")
    }
  }

  // MARK: - Driver accessors
  static func getClients () -> [AppMixerClient] {
    guard let device = Driver.device else { return [] }

    var size = UInt32(MemoryLayout<CFArray?>.size)
    var clientsRef: CFArray? = nil

    let status = AudioObjectGetPropertyData(
      device.id,
      &EQMDeviceCustom.addresses.clients,
      0,
      nil,
      &size,
      &clientsRef
    )

    guard status == noErr, let clientDicts = clientsRef as? [[String: Any]] else {
      return []
    }

    return clientDicts.compactMap { dict in
      guard let processId = (dict["processId"] as? NSNumber)?.int32Value else {
        return nil
      }
      let bundleId = dict["bundleId"] as? String
      let volume = (dict["volume"] as? NSNumber)?.doubleValue ?? 1
      let muted = (dict["muted"] as? NSNumber)?.boolValue ?? false
      return AppMixerClient(
        processId: processId,
        bundleId: bundleId,
        volume: volume,
        muted: muted
      )
    }
  }

  static func setAppVolumes (_ volumes: [String: AppVolume]) {
    guard let device = Driver.device else { return }

    let dict = NSMutableDictionary()
    for (bundleId, appVolume) in volumes {
      dict[bundleId] = [
        "volume": appVolume.volume,
        "muted": appVolume.muted
      ]
    }

    var cfDict = dict as CFDictionary
    let size = Memory.sizeof(CFDictionary.self)
    checkErr(AudioObjectSetPropertyData(
      device.id,
      &EQMDeviceCustom.addresses.appVolumes,
      0,
      nil,
      size,
      &cfDict
    ))
  }

  static func setAppVolume (bundleId: String, volume: Double, muted: Bool) {
    if let mixer = AppMixer.shared {
      mixer.setVolume(bundleId: bundleId, volume: volume, muted: muted)
    } else {
      setAppVolumes([ bundleId: AppVolume(volume: volume, muted: muted) ])
    }
  }

  static func runningApplication (processId: pid_t, bundleId: String?) -> NSRunningApplication? {
    if let app = NSRunningApplication(processIdentifier: processId) {
      return app
    }
    if let bundleId = bundleId {
      return NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first
    }
    return nil
  }

  deinit {
    if let deviceId = listeningDeviceId, let block = clientsListenerBlock {
      AudioObjectRemovePropertyListenerBlock(
        deviceId,
        &EQMDeviceCustom.addresses.clients,
        DispatchQueue.main,
        block
      )
    }
    if AppMixer.shared === self {
      AppMixer.shared = nil
    }
  }
}
