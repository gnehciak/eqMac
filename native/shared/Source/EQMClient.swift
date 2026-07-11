//
//  EQMClient.swift
//  Driver
//
//  Created by Nodeful on 07/09/2021.
//  Copyright © 2021 Bitgapp. All rights reserved.
//

import Foundation
import CoreAudio.AudioServerPlugIn

public class EQMClient {
  public var clientId: UInt32
  public var processId: pid_t
  public var bundleId: String?

  // App Mixer - per-app volume applied by the driver
  // to this client's writeMix operation (1 = unity, 0 = silence)
  public var volume: Float = 1
  public var muted: Bool = false

  public init (clientId: UInt32, processId: pid_t, bundleId: String? = nil, volume: Float = 1, muted: Bool = false) {
    self.clientId = clientId
    self.processId = processId
    self.bundleId = bundleId
    self.volume = volume
    self.muted = muted
  }

  public init (from clientInfo: AudioServerPlugInClientInfo) {
    clientId = clientInfo.mClientID
    processId = clientInfo.mProcessID
    bundleId = clientInfo.mBundleID?.takeUnretainedValue() as String?
  }

  // Effective gain for the mix path
  public var gain: Float {
    return muted ? 0 : volume
  }

  public var dictionary: [String: Any] {
    var dict = [
      "clientId": clientId,
      "processId": processId,
      "volume": volume,
      "muted": muted
    ] as [String : Any]

    if bundleId != nil {
      dict["bundleId"] = bundleId!
    }

    return dict
  }

  public var cfDictionary: CFDictionary {
    let dict = NSDictionary(dictionary: dictionary)

    return dict as CFDictionary
  }

  public var isAppClient: Bool {
    return bundleId == APP_BUNDLE_ID
  }

  public static func fromDictionary (_ dict: [String: Any]) -> EQMClient? {
    guard
      let clientId = dict["clientId"] as? UInt32,
      let processId = dict["processId"] as? pid_t
    else {
      return nil
    }
    let bundleId = dict["bundleId"] as? String
    let volume = dict["volume"] as? Float ?? 1
    let muted = dict["muted"] as? Bool ?? false

    return EQMClient(clientId: clientId, processId: processId, bundleId: bundleId, volume: volume, muted: muted)
  }
}
