//
//  HotkeyManager.swift
//  eqMac
//
//  Global hotkeys via Carbon RegisterEventHotKey / UnregisterEventHotKey +
//  InstallEventHandler(GetApplicationEventTarget(), kEventHotKeyPressed).
//  Works while eqMac is in the background and needs NO Accessibility
//  permission (unlike NSEvent global monitors).
//
//  Instantiated once by the integration wiring in Application setup:
//
//    static var hotkeys: HotkeyManager?
//    ...
//    hotkeys = HotkeyManager()
//
//  Registration is idempotent: on every HotkeysState change all hotkeys are
//  unregistered and re-registered from the store.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import Cocoa
import Carbon
import ReSwift
import EmitterKit
import Shared

/// Result of an in-app key capture session (Record button in the UI)
struct CapturedHotkey {
  let keyCode: UInt32
  let modifiers: UInt32
  var display: String {
    return HotkeyManager.display(keyCode: keyCode, modifiers: modifiers)
  }
}

class HotkeyManager: StoreSubscriber {
  // Set by init so HotkeysDataBus can reach the manager without caring
  // where the integration wiring stores the instance
  static var shared: HotkeyManager?

  // Emitted after bindings changed and hotkeys were re-registered -
  // HotkeysDataBus pushes the new bindings to the UI from this
  static let bindingsChanged = EmitterKit.Event<Void>()

  // 'EQMK' - identifies our hotkeys in the Carbon event callback
  static let signature: OSType = {
    var code: OSType = 0
    for scalar in "EQMK".unicodeScalars {
      code = (code << 8) | OSType(scalar.value & 0xFF)
    }
    return code
  }()

  // Only these Carbon modifier bits are valid in a binding
  static let validModifiersMask: UInt32 =
    UInt32(cmdKey) | UInt32(shiftKey) | UInt32(optionKey) | UInt32(controlKey)

  var state: HotkeysState {
    return Application.store.state.hotkeys
  }

  private var eventHandlerRef: EventHandlerRef?
  private var hotKeyRefs: [UInt32: EventHotKeyRef] = [:]
  private var idToAction: [UInt32: HotkeyAction] = [:]
  private var appliedBindings: [String: HotkeyBinding]?

  // MARK: - Capture session
  private var keyDownMonitor: Any?
  private var captureCompletion: ((CapturedHotkey?) -> Void)?
  private var captureSession: UInt = 0

  // MARK: - Initialization
  init () {
    Console.log("Creating HotkeyManager")
    HotkeyManager.shared = self
    installEventHandler()
    ({
      appliedBindings = state.bindings
      registerAll()
    })()
    setupStateListener()
  }

  // MARK: - State
  typealias StoreSubscriberStateType = HotkeysState

  private func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.hotkeys }
    }
  }

  func newState (state: HotkeysState) {
    if state.bindings != appliedBindings {
      appliedBindings = state.bindings
      DispatchQueue.main.async {
        self.registerAll()
        HotkeyManager.bindingsChanged.emit()
      }
    }
  }

  // MARK: - Carbon registration
  private func installEventHandler () {
    var eventSpec = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard),
      eventKind: UInt32(kEventHotKeyPressed)
    )
    let selfPointer = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
    let status = InstallEventHandler(
      GetApplicationEventTarget(),
      { (_, eventRef, userData) -> OSStatus in
        // C function pointer - no captures allowed
        guard let eventRef = eventRef, let userData = userData else { return noErr }
        var hotKeyID = EventHotKeyID()
        let status = GetEventParameter(
          eventRef,
          EventParamName(kEventParamDirectObject),
          EventParamType(typeEventHotKeyID),
          nil,
          MemoryLayout<EventHotKeyID>.size,
          nil,
          &hotKeyID
        )
        guard status == noErr, hotKeyID.signature == HotkeyManager.signature else { return noErr }
        let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
        manager.hotkeyPressed(id: hotKeyID.id)
        return noErr
      },
      1,
      &eventSpec,
      selfPointer,
      &eventHandlerRef
    )
    if status != noErr {
      Console.log("HotkeyManager: Failed to install Carbon event handler (status \(status))")
    }
  }

  /// Idempotent: drops every registered hotkey and re-registers from the store.
  /// Never registers while a capture session is armed (a registered combo
  /// would be swallowed by Carbon before the capture monitor could see it).
  private func registerAll () {
    unregisterAll()
    if captureCompletion != nil { return }

    var nextId: UInt32 = 1
    // Iterate allCases for a deterministic registration order
    for action in HotkeyAction.allCases {
      guard let binding = state.bindings[action.rawValue], binding.enabled else { continue }
      guard binding.modifiers & ~HotkeyManager.validModifiersMask == 0 else { continue }

      let id = nextId
      nextId += 1
      var hotKeyRef: EventHotKeyRef?
      let hotKeyID = EventHotKeyID(signature: HotkeyManager.signature, id: id)
      let status = RegisterEventHotKey(
        binding.keyCode,
        binding.modifiers,
        hotKeyID,
        GetApplicationEventTarget(),
        OptionBits(0),
        &hotKeyRef
      )
      if status == noErr, let hotKeyRef = hotKeyRef {
        hotKeyRefs[id] = hotKeyRef
        idToAction[id] = action
      } else {
        // eventHotKeyExistsErr etc. - combo taken by another app or duplicated
        Console.log("HotkeyManager: Failed to register hotkey for \(action.rawValue) (status \(status))")
      }
    }
  }

  private func unregisterAll () {
    for (_, hotKeyRef) in hotKeyRefs {
      UnregisterEventHotKey(hotKeyRef)
    }
    hotKeyRefs.removeAll()
    idToAction.removeAll()
  }

  private func hotkeyPressed (id: UInt32) {
    guard let action = idToAction[id] else { return }
    DispatchQueue.main.async {
      self.perform(action: action)
    }
  }

  // MARK: - Actions
  // Every handler dispatches through the same paths the UI uses,
  // so UI / driver / store stay consistent
  func perform (action: HotkeyAction) {
    switch action {
    case .volumeUp:
      changeVolume(direction: .UP)
    case .volumeDown:
      changeVolume(direction: .DOWN)
    case .muteToggle:
      Application.dispatchAction(VolumeAction.setMuted(!Application.store.state.volume.muted))
    case .boostToggle:
      Application.dispatchAction(VolumeAction.setBoostEnabled(!Application.store.state.volume.boostEnabled))
    case .nextPreset:
      cyclePreset(forward: true)
    case .previousPreset:
      cyclePreset(forward: false)
    case .eqMacEnabledToggle:
      Application.dispatchAction(ApplicationAction.setEnabled(!Application.store.state.enabled))
    case .showHideWindow:
      UI.toggle()
    }
  }

  /// Same stepping semantics as Application.volumeChangeButtonPressed,
  /// but always dispatches VolumeAction.setGain because unlike the hardware
  /// volume keys a hotkey press never reaches the driver device on its own.
  private func changeVolume (direction: VolumeChangeDirection) {
    let volume = Application.store.state.volume
    let gain = volume.gain
    let steps = Constants.FULL_VOLUME_STEPS

    var stepIndex: Int
    if direction == .UP {
      stepIndex = steps.firstIndex(where: { $0 > gain }) ?? steps.count - 1
    } else {
      stepIndex = (steps.firstIndex(where: { $0 >= gain }) ?? 0) - 1
      if (stepIndex < 0) {
        stepIndex = 0
      }
    }

    var newGain = steps[stepIndex]
    if (newGain > 1 && !volume.boostEnabled) {
      newGain = 1
    }
    Application.dispatchAction(VolumeAction.setGain(newGain, false))
  }

  // MARK: - Preset cycling
  private struct PresetCycle {
    let ids: [String]
    let selectedId: String
    let select: (String) -> Void
  }

  /// Ordered presets + selection of the ACTIVE equalizer type.
  /// Switches on the raw type value so this compiles regardless of which
  /// EqualizerType cases the integration wiring has added.
  private var presetCycle: PresetCycle? {
    let equalizers = Application.store.state.effects.equalizers
    switch equalizers.type.rawValue {
    case EqualizerType.basic.rawValue:
      return PresetCycle(
        ids: BasicEqualizer.presets.map { $0.id },
        selectedId: equalizers.basic.selectedPresetId,
        select: { id in
          Application.dispatchAction(BasicEqualizerAction.selectPreset(id, true))
        }
      )
    case EqualizerType.advanced.rawValue:
      return PresetCycle(
        ids: AdvancedEqualizer.presets.map { $0.id },
        selectedId: equalizers.advanced.selectedPresetId,
        select: { id in
          Application.dispatchAction(AdvancedEqualizerAction.selectPreset(id, true))
        }
      )
    case ExpertEqualizer.TYPE:
      return PresetCycle(
        ids: ExpertEqualizer.presets.map { $0.id },
        selectedId: equalizers.expert.selectedPresetId,
        select: { id in
          Application.dispatchAction(ExpertEqualizerAction.selectPreset(id, true))
        }
      )
    case "Graphic 31": // Raw value of the EqualizerType case the integration wiring adds
      return PresetCycle(
        ids: Graphic31Equalizer.presets.map { $0.id },
        selectedId: equalizers.graphic31.selectedPresetId,
        select: { id in
          Application.dispatchAction(Graphic31EqualizerAction.selectPreset(id, true))
        }
      )
    default:
      return nil
    }
  }

  private func cyclePreset (forward: Bool) {
    guard let cycle = presetCycle, cycle.ids.count > 0 else { return }
    let count = cycle.ids.count
    let currentIndex = cycle.ids.firstIndex(of: cycle.selectedId) ?? 0
    let nextIndex = ((currentIndex + (forward ? 1 : -1)) % count + count) % count
    cycle.select(cycle.ids[nextIndex])
  }

  // MARK: - Capture (Record button)
  /// Arms a transient LOCAL NSEvent keyDown monitor (in-app capture - the
  /// eqMac window must be frontmost, which it is while the user clicks
  /// Record in the UI; no permissions needed). All registered hotkeys are
  /// suspended for the duration so already-bound combos can be re-captured.
  /// Completes with nil on Escape, timeout or a superseding capture.
  func startCapture (timeout: UInt = 10000, _ completion: @escaping (CapturedHotkey?) -> Void) {
    DispatchQueue.main.async {
      // Only one capture session at a time - cancel any previous one
      self.finishCapture(nil)

      self.captureCompletion = completion
      self.captureSession += 1
      let session = self.captureSession

      // Suspend all hotkeys while capturing
      self.unregisterAll()

      self.keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
        guard let self = self else { return event }

        let keyCode = UInt32(event.keyCode)
        let modifiers = HotkeyManager.carbonModifiers(from: event.modifierFlags)

        // Plain Escape cancels the capture
        if keyCode == UInt32(kVK_Escape) && modifiers == 0 {
          self.finishCapture(nil)
          return nil
        }

        // Refuse modifier-less regular keys - a global binding on a bare
        // typing key would swallow it system-wide. Function keys are fine.
        if modifiers == 0 && !HotkeyManager.modifierlessKeysAllowed.contains(keyCode) {
          return nil // swallow and keep listening
        }

        self.finishCapture(CapturedHotkey(keyCode: keyCode, modifiers: modifiers))
        return nil // swallow the combo
      }

      Async.delay(timeout) { [weak self] in
        guard let self = self, self.captureSession == session else { return }
        self.finishCapture(nil)
      }
    }
  }

  /// Tears down the capture monitor, restores hotkey registrations and
  /// completes the pending capture exactly once. Safe to call when idle.
  private func finishCapture (_ captured: CapturedHotkey?) {
    if let monitor = keyDownMonitor {
      NSEvent.removeMonitor(monitor)
      keyDownMonitor = nil
    }
    let completion = captureCompletion
    captureCompletion = nil
    if completion != nil {
      registerAll()
    }
    completion?(captured)
  }

  // MARK: - Display helpers
  static func carbonModifiers (from flags: NSEvent.ModifierFlags) -> UInt32 {
    var modifiers: UInt32 = 0
    if flags.contains(.control) { modifiers |= UInt32(controlKey) }
    if flags.contains(.option) { modifiers |= UInt32(optionKey) }
    if flags.contains(.shift) { modifiers |= UInt32(shiftKey) }
    if flags.contains(.command) { modifiers |= UInt32(cmdKey) }
    return modifiers
  }

  /// Human readable combo, e.g. "⌃⌥⇧⌘F1"
  static func display (keyCode: UInt32, modifiers: UInt32) -> String {
    return modifierSymbols(modifiers) + keyDisplayString(keyCode: keyCode)
  }

  static func modifierSymbols (_ modifiers: UInt32) -> String {
    var symbols = ""
    if modifiers & UInt32(controlKey) != 0 { symbols += "⌃" }
    if modifiers & UInt32(optionKey) != 0 { symbols += "⌥" }
    if modifiers & UInt32(shiftKey) != 0 { symbols += "⇧" }
    if modifiers & UInt32(cmdKey) != 0 { symbols += "⌘" }
    return symbols
  }

  static func keyDisplayString (keyCode: UInt32) -> String {
    if let special = specialKeyNames[keyCode] {
      return special
    }
    if let translated = layoutKeyDisplay(keyCode: keyCode), translated.trim() != "" {
      return translated
    }
    return "Key \(keyCode)"
  }

  /// Current keyboard layout translation via UCKeyTranslate
  private static func layoutKeyDisplay (keyCode: UInt32) -> String? {
    guard let inputSource = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue() else {
      return nil
    }
    guard let layoutDataPointer = TISGetInputSourceProperty(inputSource, kTISPropertyUnicodeKeyLayoutData) else {
      return nil
    }
    let layoutData = unsafeBitCast(layoutDataPointer, to: CFData.self)
    guard let layoutBytes = CFDataGetBytePtr(layoutData) else { return nil }

    return layoutBytes.withMemoryRebound(to: UCKeyboardLayout.self, capacity: 1) { keyboardLayout -> String? in
      var deadKeyState: UInt32 = 0
      var actualLength: Int = 0
      var unicodeString = [UniChar](repeating: 0, count: 4)
      let status = UCKeyTranslate(
        keyboardLayout,
        UInt16(keyCode),
        UInt16(kUCKeyActionDisplay),
        0,
        UInt32(LMGetKbdType()),
        OptionBits(kUCKeyTranslateNoDeadKeysMask),
        &deadKeyState,
        unicodeString.count,
        &actualLength,
        &unicodeString
      )
      guard status == noErr, actualLength > 0 else { return nil }
      return String(utf16CodeUnits: unicodeString, count: actualLength).uppercased()
    }
  }

  /// Keys that may be bound WITHOUT a modifier (safe - they don't type text)
  static let modifierlessKeysAllowed: Set<UInt32> = [
    UInt32(kVK_F1), UInt32(kVK_F2), UInt32(kVK_F3), UInt32(kVK_F4),
    UInt32(kVK_F5), UInt32(kVK_F6), UInt32(kVK_F7), UInt32(kVK_F8),
    UInt32(kVK_F9), UInt32(kVK_F10), UInt32(kVK_F11), UInt32(kVK_F12),
    UInt32(kVK_F13), UInt32(kVK_F14), UInt32(kVK_F15), UInt32(kVK_F16),
    UInt32(kVK_F17), UInt32(kVK_F18), UInt32(kVK_F19), UInt32(kVK_F20)
  ]

  /// Names for keys UCKeyTranslate can't render (or renders as control chars)
  static let specialKeyNames: [UInt32: String] = [
    UInt32(kVK_Return): "↩",
    UInt32(kVK_Tab): "⇥",
    UInt32(kVK_Space): "Space",
    UInt32(kVK_Delete): "⌫",
    UInt32(kVK_Escape): "⎋",
    UInt32(kVK_ForwardDelete): "⌦",
    UInt32(kVK_Home): "↖",
    UInt32(kVK_End): "↘",
    UInt32(kVK_PageUp): "⇞",
    UInt32(kVK_PageDown): "⇟",
    UInt32(kVK_LeftArrow): "←",
    UInt32(kVK_RightArrow): "→",
    UInt32(kVK_UpArrow): "↑",
    UInt32(kVK_DownArrow): "↓",
    UInt32(kVK_Help): "Help",
    UInt32(kVK_F1): "F1",
    UInt32(kVK_F2): "F2",
    UInt32(kVK_F3): "F3",
    UInt32(kVK_F4): "F4",
    UInt32(kVK_F5): "F5",
    UInt32(kVK_F6): "F6",
    UInt32(kVK_F7): "F7",
    UInt32(kVK_F8): "F8",
    UInt32(kVK_F9): "F9",
    UInt32(kVK_F10): "F10",
    UInt32(kVK_F11): "F11",
    UInt32(kVK_F12): "F12",
    UInt32(kVK_F13): "F13",
    UInt32(kVK_F14): "F14",
    UInt32(kVK_F15): "F15",
    UInt32(kVK_F16): "F16",
    UInt32(kVK_F17): "F17",
    UInt32(kVK_F18): "F18",
    UInt32(kVK_F19): "F19",
    UInt32(kVK_F20): "F20",
    UInt32(kVK_ANSI_Keypad0): "Num 0",
    UInt32(kVK_ANSI_Keypad1): "Num 1",
    UInt32(kVK_ANSI_Keypad2): "Num 2",
    UInt32(kVK_ANSI_Keypad3): "Num 3",
    UInt32(kVK_ANSI_Keypad4): "Num 4",
    UInt32(kVK_ANSI_Keypad5): "Num 5",
    UInt32(kVK_ANSI_Keypad6): "Num 6",
    UInt32(kVK_ANSI_Keypad7): "Num 7",
    UInt32(kVK_ANSI_Keypad8): "Num 8",
    UInt32(kVK_ANSI_Keypad9): "Num 9",
    UInt32(kVK_ANSI_KeypadClear): "⌧",
    UInt32(kVK_ANSI_KeypadDecimal): "Num .",
    UInt32(kVK_ANSI_KeypadDivide): "Num /",
    UInt32(kVK_ANSI_KeypadEnter): "⌤",
    UInt32(kVK_ANSI_KeypadEquals): "Num =",
    UInt32(kVK_ANSI_KeypadMinus): "Num -",
    UInt32(kVK_ANSI_KeypadMultiply): "Num *",
    UInt32(kVK_ANSI_KeypadPlus): "Num +"
  ]

  deinit {
    Application.store.unsubscribe(self)
    finishCapture(nil)
    unregisterAll()
    if let handler = eventHandlerRef {
      RemoveEventHandler(handler)
      eventHandlerRef = nil
    }
    if HotkeyManager.shared === self {
      HotkeyManager.shared = nil
    }
  }
}
