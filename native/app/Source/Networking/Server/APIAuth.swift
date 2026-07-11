//
//  APIAuth.swift
//  eqMac
//
//  Bearer token authentication for the HTTP + WebSocket API servers.
//  Tokens are generated on first pairing (after a native confirmation alert)
//  and stored in the Keychain under Constants.TOKEN_STORAGE_KEY.
//  Localhost requests are exempt by default, LAN clients require a token.
//

import Foundation
import SwiftyJSON

struct APIPairedDevice: Codable {
  let token: String
  let name: String
  let created: Double
}

class APIAuth {
  static let shared = APIAuth()

  // Header stamped by the HTTP server with the TCP remote host of every
  // request (always overwritten so clients cannot spoof it)
  static let REMOTE_HOST_HEADER = "X-eqMac-Remote-Host"
  static let PAIR_PATH = "/pair"
  static let PAIRING_TIMEOUT: Double = 60

  static func extractBearerToken (_ header: String?) -> String? {
    guard let header = header else { return nil }
    let prefix = "Bearer "
    guard header.hasPrefix(prefix) else { return nil }
    let token = String(header.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
    return token == "" ? nil : token
  }

  // MARK: - Tokens
  private let accessQueue = DispatchQueue(label: "eqMac.APIAuth.access")
  private var devices: [APIPairedDevice] = []

  init () {
    load()
  }

  var pairedDevices: [APIPairedDevice] {
    return accessQueue.sync { devices }
  }

  private func load () {
    guard let raw = Keychain.get(Constants.TOKEN_STORAGE_KEY),
      let data = raw.data(using: .utf8),
      let stored = try? JSONDecoder().decode([APIPairedDevice].self, from: data)
      else { return }
    accessQueue.sync {
      devices = stored
    }
  }

  private func save () {
    let current = accessQueue.sync { devices }
    guard let data = try? JSONEncoder().encode(current),
      let raw = String(data: data, encoding: .utf8)
      else { return }
    Keychain.set(raw, forKey: Constants.TOKEN_STORAGE_KEY)
  }

  func validate (token: String) -> Bool {
    if (token == "") { return false }
    return accessQueue.sync {
      devices.contains { $0.token == token }
    }
  }

  @discardableResult
  func generateToken (name: String) -> APIPairedDevice {
    let device = APIPairedDevice(
      token: APIAuth.randomToken(),
      name: name,
      created: Date().timeIntervalSince1970
    )
    accessQueue.sync {
      devices.append(device)
    }
    save()
    return device
  }

  func revokeAll () {
    accessQueue.sync {
      devices = []
    }
    Keychain.delete(Constants.TOKEN_STORAGE_KEY)
  }

  private static func randomToken () -> String {
    return (UUID().uuidString + UUID().uuidString)
      .replacingOccurrences(of: "-", with: "")
      .lowercased()
  }

  // MARK: - Pairing
  private var pairingInProgress = false

  // Shows a native confirmation alert asking the user to allow the remote
  // device. Completion receives the newly generated token, or nil if the
  // user denied the request (or another pairing request is already showing).
  // Completion is invoked on the main thread.
  func requestPairing (name: String, host: String, completion: @escaping (String?) -> Void) {
    let alreadyPairing: Bool = accessQueue.sync {
      if (pairingInProgress) { return true }
      pairingInProgress = true
      return false
    }
    if (alreadyPairing) {
      return completion(nil)
    }
    Alert.confirm(
      title: "Allow Remote Access?",
      message: "\"\(name)\" (\(host)) is trying to remotely control eqMac. Allow this device?",
      okText: "Allow",
      cancelText: "Deny"
    ) { [weak self] allowed in
      guard let self = self else { return completion(nil) }
      self.accessQueue.sync {
        self.pairingInProgress = false
      }
      if (!allowed) { return completion(nil) }
      let device = self.generateToken(name: name)
      completion(device.token)
    }
  }
}
