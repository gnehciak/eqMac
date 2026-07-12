//
//  Constants.swift
//  eqMac
//
//  Created by Roman Kisil on 22/01/2018.
//  Copyright © 2018 Roman Kisil. All rights reserved.
//

import Foundation
import AMCoreAudio
import Version

struct Constants {
  
  // Fork: the UI is ALWAYS loaded from the copy embedded in the app bundle -
  // there is no over-the-air fetch from any server (see UI.load()). This
  // endpoint only remains for the DEBUG live-reload dev server on localhost.
  #if DEBUG
  static let UI_ENDPOINT_URL = URL(string: "http://localhost:8080")!
  static let DEBUG = true
  #else
  static let DEBUG = false
  static let UI_ENDPOINT_URL = URL(string: "http://localhost:8080")!
  #endif

  // This is an open-source fork with no vendor backend: no crash reporting,
  // no analytics, no update feed, no remote UI. All of the below point at the
  // fork's own repository rather than the original vendor's services.
  static let DOMAIN = "github.com/gnehciak/eqMac"
  static let WEBSITE_URL = URL(string: "https://github.com/gnehciak/eqMac")!
  static let FAQ_URL = URL(string: "https://github.com/gnehciak/eqMac#readme")!
  static let BUG_REPORT_URL = URL(string: "https://github.com/gnehciak/eqMac/issues")!
  static let DRIVER_DEVICE_UID = "EQMDevice"
  static let DRIVER_MINIMUM_VERSION = Version(tolerant: "1.3")!
  static let LEGACY_DRIVER_UIDS = ["EQMAC2.1_DRIVER_ENGINE", "EQMAC2_DRIVER_ENGINE"]
  static let TOKEN_STORAGE_KEY = "eqMac Server Tokens"
  static let UI_SERVER_PREFERRED_PORT: UInt = 37628
  static let HTTP_SERVER_PREFERRED_PORT: UInt = 37624
  static let SOCKET_SERVER_PREFERRED_PORT: UInt = 37629
  static let FULL_VOLUME_STEP = 1.0 / 16
  static let QUARTER_VOLUME_STEP = FULL_VOLUME_STEP / 4
  static let FULL_VOLUME_STEPS: [Double] = Array(stride(from: 0.0, through: 2.0, by: FULL_VOLUME_STEP))
  static let QUARTER_VOLUME_STEPS: [Double] = Array(stride(from: 0.0, through: 2.0, by: QUARTER_VOLUME_STEP))
  
  static let TRANSITION_DURATION: UInt = 500
  static let TRANSITION_FPS: Double = 30
  static let TRANSITION_FRAME_DURATION: Double = 1000 / TRANSITION_FPS
  static let TRANSITION_FRAME_COUNT = UInt(round(TRANSITION_FPS * (Double(TRANSITION_DURATION) / 1000)))
  static let OPEN_SOURCE = true
  // Fork: automatic updates are removed entirely; there is no update feed.
  static let OPEN_URL_TRUSTED_DOMAINS: [String] = ["github.com"]
  static let TRUSTED_URL_PREFIXES: [String] = [
    "https://github.com/gnehciak/eqMac",
    "https://github.com/jaakkopasanen/AutoEq"
  ]
}

