//
//  HearingTestDataBus.swift
//  eqMac
//
//  Created by Romans Kisils on 12/07/2026.
//  Copyright © 2026 Romans Kisils. All rights reserved.
//

import Foundation
import SwiftyJSON
import EmitterKit

/// Mounted at '/hearing-test' (see ApplicationDataBus).
///
/// Routes:
///   GET  /session  -> { active: Bool }
///   POST /session  { active: Bool } - activate / deactivate a test session.
///                  While active the active Equalizer is remembered +
///                  disabled and restored on deactivate / abort.
///   POST /tone     { frequency: 20-20000, gainDb: -80...0, ear: 'left'|'right' }
///                  - start or retune the test tone
///   POST /stop     - fade the tone out
///
/// Push events:
///   /aborted { aborted: true } - the audio pipeline was torn down mid
///   session (device / sample rate / EQ type change, eqMac disabled, sleep).
class HearingTestDataBus: DataBus {
  static let MIN_FREQUENCY = 20.0
  static let MAX_FREQUENCY = 20_000.0
  static let MIN_GAIN_DB = -80.0
  static let MAX_GAIN_DB = 0.0

  private var sessionActive = false
  private var equalizersWereEnabled: Bool?

  private var applicationEnabledListener: EventListener<Bool>?
  private var outputCreatedListener: EventListener<Void>?

  required init (route: String, bridge: Bridge) {
    super.init(route: route, bridge: bridge)

    self.on(.GET, "/session") { _, _ in
      return [ "active": self.sessionActive ]
    }

    self.on(.POST, "/session") { data, _ in
      guard let active = data["active"] as? Bool else {
        throw "Invalid 'active' parameter, must be a boolean"
      }

      if (active) {
        try self.activateSession()
        return "Hearing Test session has been activated"
      } else {
        self.deactivateSession()
        return "Hearing Test session has been deactivated"
      }
    }

    self.on(.POST, "/tone") { data, _ in
      guard self.sessionActive else {
        throw "Hearing Test session is not active"
      }

      guard let frequency = data["frequency"] as? Double,
            (HearingTestDataBus.MIN_FREQUENCY ... HearingTestDataBus.MAX_FREQUENCY).contains(frequency) else {
        throw "Invalid 'frequency' parameter, must be a number between 20 and 20000"
      }

      guard let gainDb = data["gainDb"] as? Double,
            (HearingTestDataBus.MIN_GAIN_DB ... HearingTestDataBus.MAX_GAIN_DB).contains(gainDb) else {
        throw "Invalid 'gainDb' parameter, must be a number between -80 and 0"
      }

      guard let earParameter = data["ear"] as? String,
            let ear = ToneGeneratorEar(rawValue: earParameter) else {
        throw "Invalid 'ear' parameter, must be either 'left' or 'right'"
      }

      guard Application.output != nil && Application.engine != nil else {
        // Output was torn down under an active session - abort it
        self.abortSession()
        throw "Audio engine is not running"
      }

      try ToneGenerator.shared.play(frequency: frequency, gainDb: gainDb, ear: ear)

      return "Tone has been started"
    }

    self.on(.POST, "/stop") { _, _ in
      ToneGenerator.shared.stop()
      return "Tone has been stopped"
    }
  }

  private func activateSession () throws {
    if (sessionActive) { return }

    guard ToneGenerator.isSupported else {
      throw "The Hearing Test requires macOS 10.15 (Catalina) or newer"
    }

    guard Application.output != nil && Application.engine != nil else {
      throw "Audio engine is not running. Make sure eqMac is enabled and an output device is selected"
    }

    sessionActive = true

    // Remember + disable the active Equalizer so it doesn't color audio
    // during the test. Restored on deactivate / abort.
    equalizersWereEnabled = Application.store.state.effects.equalizers.enabled
    if (equalizersWereEnabled == true) {
      Application.dispatchAction(EqualizersAction.setEnabled(false))
    }

    // Abort if the audio pipeline is torn down mid session
    applicationEnabledListener = Application.enabledChanged.on { [weak self] enabled in
      if (!enabled) {
        self?.abortSession()
      }
    }
    // A new Output means the previous output engine (and the attached tone
    // node) was torn down - device / sample rate / jack / EQ type change
    outputCreatedListener = Application.outputCreated.on { [weak self] in
      self?.abortSession()
    }
  }

  private func deactivateSession () {
    guard sessionActive else { return }
    sessionActive = false

    stopListeners()

    ToneGenerator.shared.teardown()

    if (equalizersWereEnabled == true) {
      Application.dispatchAction(EqualizersAction.setEnabled(true))
    }
    equalizersWereEnabled = nil
  }

  private func abortSession () {
    guard sessionActive else { return }
    DispatchQueue.main.async {
      guard self.sessionActive else { return }
      self.deactivateSession()
      self.send(to: "/aborted", data: JSON([ "aborted": true ]))
    }
  }

  private func stopListeners () {
    applicationEnabledListener?.isListening = false
    applicationEnabledListener = nil

    outputCreatedListener?.isListening = false
    outputCreatedListener = nil
  }
}
