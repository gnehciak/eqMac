//
//  Driver.swift
//  eqMac
//
//  Created by Roman Kisil on 30/10/2018.
//  Copyright © 2018 Roman Kisil. All rights reserved.
//

import Foundation
import AMCoreAudio
import CoreFoundation
import Version
import EmitterKit
import Shared

class Driver {
  static func check (_ completion: @escaping() -> Void) {
    if Driver.isInstalled && Driver.isCompatible {
      return completion()
    }

    // Fork: the audio driver ships inside the app bundle and is installed on
    // demand (with an admin prompt) instead of via a separate signed installer
    // or a "download from our website" link. This makes a fresh-Mac first run
    // self-contained: grant permission once and the virtual device appears.
    let isIncompatible = Driver.isInstalled && !Driver.isCompatible
    let title = isIncompatible
      ? "Update the eqMac Audio Driver"
      : "Install the eqMac Audio Driver"
    let message = isIncompatible
      ? "eqMac needs to update its audio driver. This replaces the driver in your system audio plug-ins folder and briefly restarts Core Audio. You'll be asked for your administrator password."
      : "eqMac needs to install its audio driver so it can process your system audio. This adds a driver to your system audio plug-ins folder and briefly restarts Core Audio. You'll be asked for your administrator password."

    Alert.withButtons(
      title: title,
      message: message,
      buttons: [ isIncompatible ? "Update Driver" : "Install Driver", "Quit" ]
    ) { buttonPressed in
      switch NSApplication.ModalResponse(buttonPressed) {
        case .alertFirstButtonReturn:
          Driver.install(completion)
        default:
          Application.quit()
      }
    }
  }

  // Installs the bundled driver via the privileged install-driver.sh script
  // (STPrivilegedTask → admin prompt), then waits for CoreAudio to publish the
  // virtual device before continuing startup.
  private static func install (_ completion: @escaping () -> Void) {
    Script.sudo("install-driver") { success in
      DispatchQueue.main.async {
        if !success {
          return Alert.confirm(
            title: "Driver installation failed",
            message: "eqMac couldn't install its audio driver. You can try again, or quit and install it manually.",
            okText: "Try Again",
            cancelText: "Quit"
          ) { retry in
            if retry { Driver.install(completion) } else { Application.quit() }
          }
        }
        // CoreAudio needs a moment to load the freshly-installed plug-in.
        Driver.waitForInstall(attempts: 0, completion)
      }
    }
  }

  private static func waitForInstall (attempts: Int, _ completion: @escaping () -> Void) {
    if Driver.isInstalled && Driver.isCompatible {
      return completion()
    }
    if attempts >= 20 {
      return Alert.confirm(
        title: "Driver didn't activate",
        message: "The audio driver was installed but Core Audio hasn't picked it up yet. Restarting your Mac usually resolves this.",
        okText: "Restart eqMac",
        cancelText: "Quit"
      ) { restart in
        if restart { Application.restart() } else { Application.quit() }
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(500)) {
      Driver.waitForInstall(attempts: attempts + 1, completion)
    }
  }

  private static var showChecks: Int = 0
  private static var showCheckQueue: DispatchQueue?

  static func show (_ completion: @escaping() -> Void) {
    if (hidden) {
      shown = true
      showChecks = 0
      showCheckQueue = DispatchQueue(label: "check-driver-shown", qos: .userInteractive)
      showCheckQueue!.asyncAfter(deadline: .now() + .milliseconds(500)) {
        return waitAndCheckForShown(completion)
      }
    } else {
      completion()
    }
  }
  private static func waitAndCheckForShown (_ completion: @escaping() -> Void) {
    showChecks += 1
    if (device == nil) {
      if (showChecks > 5) {
        return failedToShowPrompt()
      }
      showCheckQueue!.asyncAfter(deadline: .now() + .milliseconds(500)) {
        return waitAndCheckForShown(completion)
      }
      return
    }
    showCheckQueue = nil
    completion()
  }

  private static func failedToShowPrompt () {
    Alert.confirm(
    title: "Driver failed to activate", message: "Unfortunately the audio driver has failed to active. You can restart eqMac and try again or quit.", okText: "Try again", cancelText: "Quit") { restart in
      if restart {
        return Application.restart()
      } else {
        return Application.quit()
      }
    }
  }

  static var pluginId: AudioObjectID? {
    return AudioDevice.lookupIDByPluginBundleID(by: DRIVER_BUNDLE_ID)
  }
  
  static var isInstalled: Bool {
    get {
      return self.device != nil || self.pluginId != nil
    }
  }

  static var name: String {
    get {
      return device!.name
    }
    set {
      let size = Memory.sizeof(CFString.self)
      var name = newValue as CFString
      checkErr(AudioObjectSetPropertyData(Driver.device!.id, &EQMDeviceCustom.addresses.name, 0, nil, size, &name))
    }
  }

  static var latency: UInt32 {
    get {
      return Driver.device!.latency(direction: .playback)!
    }
    set {
      let size = Memory.sizeof(CFNumber.self)

      var newLatency = newValue
      var latency: CFNumber = CFNumberCreate(kCFAllocatorDefault, CFNumberType.sInt32Type, &newLatency)
      
      checkErr(AudioObjectSetPropertyData(Driver.device!.id, &EQMDeviceCustom.addresses.latency, 0, nil, size, &latency))
    }
  }

  static var shown: Bool {
    get {
      if Driver.device == nil { return false }
      var size: UInt32 = UInt32(MemoryLayout<CFBoolean>.size)
      
      var shownBool = kCFBooleanFalse
      
      let err = AudioObjectGetPropertyData(Driver.device!.id, &EQMDeviceCustom.addresses.shown, 0, nil, &size, &shownBool)
      if err == noErr {
        return CFBooleanGetValue(shownBool!)
      }
      
      // Workaround around a bug in the Driver where it wasn't aware of address
      return Driver.device!.canBeDefaultDevice(direction: .playback)
    }
    set {
      if Driver.device == nil { return }
      
      let size: UInt32 = UInt32(MemoryLayout<CFBoolean>.size)
      var shownBool: CFBoolean = newValue.cfBooleanValue
      
      checkErr(AudioObjectSetPropertyData(Driver.device!.id, &EQMDeviceCustom.addresses.shown, 0, nil, size, &shownBool))
    }
  }
  
  static var installedVersion: Version {
    if Driver.device == nil { return .null }
    var size: UInt32 = UInt32(MemoryLayout<CFString>.size)
    
    var version: CFString? = nil
    
    checkErr(AudioObjectGetPropertyData(Driver.device!.id, &EQMDeviceCustom.addresses.version, 0, nil, &size, &version))

    let verStr = version as String?
    return verStr != nil ? (Version(tolerant: verStr!) ?? .null) : .null
  }
  
  static var isCompatible: Bool {
    // Fork: the original hard-capped compatibility at < 2.0.0, which excluded
    // this fork's own bumped driver. Any installed driver at or above the
    // minimum supported version is compatible; a transient .null (device not
    // yet enumerated) reads as not-yet-compatible and the caller retries.
    let version = installedVersion
    if version == .null { return false }
    return version >= Constants.DRIVER_MINIMUM_VERSION
  }
  
  static var hidden: Bool {
    get { return !shown }
    set { shown = !newValue }
  }
  
  static var device: AudioDevice? {
    return AudioDevice.lookup(by: Constants.DRIVER_DEVICE_UID)
  }
  
}

