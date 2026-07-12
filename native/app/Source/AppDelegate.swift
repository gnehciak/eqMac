//
//  AppDelegate.swift
//  eqMac
//
//  Created by Roman Kisil on 27/11/2017.
//  Copyright © 2017 Roman Kisil. All rights reserved.
//

import Cocoa
import SwiftyJSON
import ServiceManagement
import EmitterKit
import AMCoreAudio
import Shared

@NSApplicationMain
class AppDelegate: NSObject, NSApplicationDelegate {

  func applicationDidFinishLaunching(_ aNotification: Notification) {
    for window in NSApplication.shared.windows {
      window.close()
    }

    // Fork: the Sparkle auto-updater is removed entirely - it pointed at the
    // original vendor's appcast (an "update" would replace this fork with the
    // closed-source build), so the app now just starts directly and never
    // contacts any update server.
    Application.start()

    NSWorkspace.shared.notificationCenter.addObserver(
        self, selector: #selector(didWakeUp(event:)),
        name: NSWorkspace.didWakeNotification, object: nil)

    NSWorkspace.shared.notificationCenter.addObserver(
        self, selector: #selector(willSleep(event:)),
        name: NSWorkspace.willSleepNotification, object: nil)
  }
  
  func applicationWillTerminate(_ aNotification: Notification) {
    Application.handleTermination()
  }
  
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    UI.show()
    return true
  }
  
  func applicationWillBecomeActive(_ notification: Notification) {
    
  }
  
  func applicationDidBecomeActive(_ notification: Notification) {
//    if (UI.hasLoaded) {
//      UI.show()
//    }
  }

  func applicationDidResignActive(_ notification: Notification) {
    if UI.mode == .popover {
      UI.close()
    }
  }
  
  @objc func willSleep(event: NSNotification) {
    Application.handleSleep()
  }

  @objc func didWakeUp(event: NSNotification) {
    Application.handleWakeUp()
  }
}


