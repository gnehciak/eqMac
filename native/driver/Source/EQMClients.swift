//
//  EQMClients.swift
//  eqMac
//
//  Created by Nodeful on 29/08/2021.
//  Copyright © 2021 Bitgapp. All rights reserved.
//

import Foundation
import CoreAudio.AudioServerPlugIn
import Atomics
import Shared

class EQMClients {
  private static let mutex = Mutex()
  static var clients: [UInt32: EQMClient] = [:]

  // App Mixer - persisted per-app volumes pushed down by the eqMac app
  // via the 'apvl' custom property. Applied to matching clients immediately
  // and to new clients of a known bundleId when they connect.
  private static var appVolumes: [String: (volume: Float32, muted: Bool)] = [:]

  // MARK: - Lock-free gain snapshot (App Mixer realtime path)
  // Fixed-size parallel arrays rebuilt on the control path (under the mutex)
  // whenever clients or their volumes change. The realtime writeMix path
  // resolves a client's gain once per IO cycle with a plain linear scan -
  // no locks, no allocation, no dictionary access.
  private static let gainSnapshotCapacity = 128
  private static let gainSnapshotClientIds = UnsafeMutablePointer<UInt32>.allocate(capacity: gainSnapshotCapacity)
  private static let gainSnapshotGains = UnsafeMutablePointer<Float32>.allocate(capacity: gainSnapshotCapacity)
  private static let gainSnapshotCount = ManagedAtomic<Int>(0)

  static func add (_ client: EQMClient) {
    mutex.lock()
    if let bundleId = client.bundleId, let saved = appVolumes[bundleId] {
      client.volume = saved.volume
      client.muted = saved.muted
    }
    clients[client.clientId] = client
    rebuildGainSnapshot()
    mutex.unlock()
  }

  static func remove (_ client: EQMClient) {
    mutex.lock()
    clients.removeValue(forKey: client.clientId)
    rebuildGainSnapshot()
    mutex.unlock()
  }

  static func get (clientId: UInt32) -> EQMClient? {
    mutex.lock()
    let client = clients[clientId]
    mutex.unlock()
    return client
  }

  static func get (processId: pid_t) -> EQMClient? {
    mutex.lock()
    let client = clients.values.first { $0.processId == processId }
    mutex.unlock()
    return client
  }

  static func get (bundleId: String) -> [EQMClient] {
    mutex.lock()
    let matchingClients = clients.values.filter { client in
      return client.bundleId == bundleId
    }
    mutex.unlock()
    return matchingClients
  }

  static func get (client: EQMClient) -> EQMClient? {
    if let byClient = get(clientId: client.clientId) {
      return byClient
    }

    if let byProcessId = get(processId: client.processId) {
      return byProcessId
    }

    if let bundleId = client.bundleId {
      let bundles = get(bundleId: bundleId)
      return bundles.first
    }

    return nil
  }

  static var list: [EQMClient] {
    mutex.lock()
    let allClients = Array(clients.values)
    mutex.unlock()
    return allClients
  }

  static var isAppClientPresent: Bool {
    return Array(clients.values).contains { $0.bundleId == APP_BUNDLE_ID }
  }

  // MARK: - App Mixer volumes

  static func setAppVolume (bundleId: String, volume: Float32, muted: Bool) {
    mutex.lock()
    appVolumes[bundleId] = (volume: volume, muted: muted)
    for client in clients.values where client.bundleId == bundleId {
      client.volume = volume
      client.muted = muted
    }
    rebuildGainSnapshot()
    mutex.unlock()
  }

  static var appVolumesDictionary: [String: [String: Any]] {
    mutex.lock()
    var dict: [String: [String: Any]] = [:]
    for (bundleId, saved) in appVolumes {
      dict[bundleId] = [
        "volume": saved.volume,
        "muted": saved.muted
      ]
    }
    mutex.unlock()
    return dict
  }

  // Resolve a client's App Mixer gain. Realtime safe - called from
  // EQMDevice.doIO once per writeMix cycle, outside the frame loop.
  static func gain (clientId: UInt32) -> Float32 {
    let count = gainSnapshotCount.load(ordering: .acquiring)
    for index in 0 ..< count {
      if gainSnapshotClientIds[index] == clientId {
        return gainSnapshotGains[index]
      }
    }
    return 1
  }

  // Must be called with the mutex held
  private static func rebuildGainSnapshot () {
    gainSnapshotCount.store(0, ordering: .releasing)
    var count = 0
    for client in clients.values {
      if count == gainSnapshotCapacity { break }
      // The eqMac app's own IO must never be scaled
      if client.isAppClient { continue }
      gainSnapshotClientIds[count] = client.clientId
      gainSnapshotGains[count] = client.muted ? 0 : client.volume
      count += 1
    }
    gainSnapshotCount.store(count, ordering: .releasing)
  }
}
