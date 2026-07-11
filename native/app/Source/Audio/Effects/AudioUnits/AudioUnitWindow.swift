//
//  AudioUnitWindow.swift
//  eqMac
//
//  NSWindowController hosting a third-party Audio Unit's custom editor view
//  (auAudioUnit.requestViewController). If the unit does not provide a view
//  controller an informational Alert is shown instead (a generic parameter
//  list fallback is deliberately out of scope).
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import Cocoa
import AVFoundation
import CoreAudioKit

class AudioUnitWindow: NSWindowController, NSWindowDelegate {
  private let auAudioUnit: AUAudioUnit
  private let unitName: String
  private var shown = false
  private var requesting = false

  /// Fired when the window closes or the unit turned out to have no editor.
  /// AudioUnitsHost uses it to drop its reference and schedule a state save.
  var onClose: (() -> Void)?

  init (name: String, auAudioUnit: AUAudioUnit) {
    self.unitName = name
    self.auAudioUnit = auAudioUnit

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
      styleMask: [ .titled, .closable, .miniaturizable, .resizable ],
      backing: .buffered,
      defer: false
    )
    window.title = name
    window.isReleasedWhenClosed = false

    super.init(window: window)

    window.delegate = self
  }

  required init? (coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  /// Request the editor view controller and show the window once it arrives.
  /// Must be called on the main thread.
  func show () {
    if shown {
      focus()
      return
    }
    if requesting { return }
    requesting = true

    auAudioUnit.requestViewController { [weak self] viewController in
      // Documented to complete on the main thread - hop anyway to be safe
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.requesting = false
        guard let viewController = viewController else {
          Alert.info(
            title: self.unitName,
            message: "This Audio Unit does not provide a custom editor view."
          )
          self.onClose?()
          return
        }
        self.window?.contentViewController = viewController
        self.window?.center()
        self.shown = true
        self.focus()
      }
    }
  }

  func focus () {
    // No-op until the editor view controller has arrived - otherwise a
    // second open request while the first is in flight would surface an
    // empty window
    guard shown else { return }
    NSApp.activate(ignoringOtherApps: true)
    showWindow(nil)
    window?.makeKeyAndOrderFront(nil)
  }

  func windowWillClose (_ notification: Notification) {
    shown = false
    onClose?()
  }
}
