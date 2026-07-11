//
//  MIDIManager.swift
//  eqMac
//
//  CoreMIDI controller support. Listens to every MIDI source on the system
//  (hot-plug aware), parses Control Change + Note On messages and drives
//  eqMac through the ReSwift store based on the user's persisted mappings.
//
//  Threading model:
//  - CoreMIDI delivers packets on its own high-priority thread. The read
//    block only parses bytes into value types and hops onto the serial
//    `queue` - it never touches the ReSwift store.
//  - All mutable manager state (mappings mirror, learn mode, coalescing)
//    is confined to the serial `queue`.
//  - Store reads / dispatches and CoreMIDI port mutations happen on the
//    main thread (dispatchAction hops to main itself).
//  - Continuous targets (volume / balance / preamp gain) are coalesced to
//    <= 30Hz per target with a trailing-edge timer, because the root
//    reducer JSON-encodes the ENTIRE state tree to UserDefaults on every
//    action - 7-bit CC streams must never flood the store.
//
//  Integration: `_ = MIDIManager.shared` once during Application setup
//  (after the store exists), + `midi` substate wiring in ApplicationState.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import CoreMIDI
import ReSwift
import EmitterKit
import Shared

// MARK: - Device model

struct MIDIDevice: Codable {
  let id: Int
  let name: String
  let online: Bool
}

// MARK: - Manager

class MIDIManager: StoreSubscriber {
  static let shared = MIDIManager()

  // MARK: - Events
  // Static so MIDIDataBus can push UI events without owning the instance.
  static let devicesChanged = EmitterKit.Event<[MIDIDevice]>()
  static let mappingsChanged = EmitterKit.Event<[MIDIMapping]>()
  static let enabledChanged = EmitterKit.Event<Bool>()

  // MARK: - Constants
  /// Trailing-edge coalescing interval for continuous targets (<= 30Hz)
  static let coalesceInterval: Double = 1.0 / 30.0
  /// Learn mode disarms itself when no message arrives in time.
  /// Must stay BELOW the 15s async-reply ceilings of the wave-1 remote
  /// transports (HandlerRegistry.dispatchTimeout / RemoteTransport
  /// .requestTimeout) so remote clients see the real error, not a generic
  /// request timeout.
  static let learnTimeout: Double = 10
  /// CoreMIDI fires setup-changed notifications in bursts - debounce them
  static let devicesDebounceInterval: Double = 0.5

  var state: MIDIState {
    return Application.store.state.midi
  }

  // MARK: - Properties
  // Serial queue - all mutable manager state below lives on this queue
  private let queue = DispatchQueue(label: "eqMac MIDI", qos: .userInteractive)

  // CoreMIDI (mutated on the main thread only)
  private var client = MIDIClientRef()
  private var inputPort = MIDIPortRef()
  private var clientCreated = false
  private var connectedSources: [MIDIEndpointRef] = []

  // Queue-confined mirrors of the store substate - the CoreMIDI read block
  // must never read the ReSwift store from its own thread
  private var activeMappings: [MIDIMapping] = []
  private var processingEnabled = false

  // Learn mode (queue-confined)
  private var learnTarget: MIDIMappingTarget?
  private var learnCompletion: ((MIDIMapping?, String?) -> Void)?
  private var learnToken = 0

  // Discrete CC targets fire on the value crossing 64 upwards -
  // previous value per mapping id (queue-confined)
  private var lastCCValues: [String: Int] = [:]

  // Continuous coalescing - latest pending value + scheduled flag per target
  // (queue-confined)
  private var pendingValues: [MIDIMappingTarget: Double] = [:]
  private var flushScheduled: Set<MIDIMappingTarget> = []

  // Devices notification debounce (queue-confined)
  private var devicesNotificationWorkItem: DispatchWorkItem?

  // Last applied store values - newState fires on every store action
  private var appliedEnabled: Bool?
  private var appliedMappings: [MIDIMapping]?

  // MARK: - Initialization
  init () {
    Console.log("Creating MIDIManager")
    applyState(Application.store.state.midi)
    setupStateListener()
  }

  // MARK: - State
  typealias StoreSubscriberStateType = MIDIState

  private func setupStateListener () {
    Application.store.subscribe(self) { subscription in
      subscription.select { state in state.midi }
    }
  }

  func newState (state: MIDIState) {
    applyState(state)
  }

  private func applyState (_ state: MIDIState) {
    if state.enabled != appliedEnabled {
      appliedEnabled = state.enabled
      if state.enabled {
        ensureSetup()
      }
      queue.async { self.processingEnabled = state.enabled }
      MIDIManager.enabledChanged.emit(state.enabled)
    }

    if state.mappings != appliedMappings {
      appliedMappings = state.mappings
      queue.async {
        self.activeMappings = state.mappings
        // Forget crossing state of mappings that no longer exist
        let ids = Set(state.mappings.map { $0.id })
        self.lastCCValues = self.lastCCValues.filter { ids.contains($0.key) }
      }
      MIDIManager.mappingsChanged.emit(state.mappings)
    }
  }

  // MARK: - Devices
  /// All MIDI devices known to the system, including currently unplugged
  /// ones (kMIDIPropertyOffline). Works without a client.
  var devices: [MIDIDevice] {
    var devices: [MIDIDevice] = []
    for index in 0 ..< MIDIGetNumberOfDevices() {
      let device = MIDIGetDevice(index)
      if device == 0 { continue }

      var offline: Int32 = 0
      MIDIObjectGetIntegerProperty(device, kMIDIPropertyOffline, &offline)

      var uniqueId: Int32 = 0
      MIDIObjectGetIntegerProperty(device, kMIDIPropertyUniqueID, &uniqueId)

      var nameRef: Unmanaged<CFString>?
      MIDIObjectGetStringProperty(device, kMIDIPropertyName, &nameRef)
      let name = (nameRef?.takeRetainedValue() as String?) ?? "Unknown MIDI Device"

      devices.append(MIDIDevice(
        id: Int(uniqueId),
        name: name,
        online: offline == 0
      ))
    }
    return devices
  }

  // MARK: - CoreMIDI setup
  /// Creates the client + input port and connects every source.
  /// Main thread only (called from applyState / armLearn).
  private func ensureSetup () {
    if clientCreated { return }

    let clientStatus = MIDIClientCreateWithBlock("eqMac" as CFString, &client) { [weak self] notification in
      self?.handle(notification: notification.pointee)
    }
    guard clientStatus == noErr else {
      Console.log("MIDIManager: Failed to create MIDI Client - \(clientStatus)")
      return
    }

    let portStatus = MIDIInputPortCreateWithBlock(client, "eqMac Input" as CFString, &inputPort) { [weak self] packetList, _ in
      self?.handle(packetList: packetList)
    }
    guard portStatus == noErr else {
      Console.log("MIDIManager: Failed to create MIDI Input Port - \(portStatus)")
      MIDIClientDispose(client)
      client = MIDIClientRef()
      return
    }

    clientCreated = true
    connectAllSources()
  }

  /// Main thread only
  private func connectAllSources () {
    guard clientCreated else { return }
    disconnectAllSources()
    for index in 0 ..< MIDIGetNumberOfSources() {
      let source = MIDIGetSource(index)
      if source == 0 { continue }
      let status = MIDIPortConnectSource(inputPort, source, nil)
      if status == noErr {
        connectedSources.append(source)
      }
    }
  }

  /// Main thread only
  private func disconnectAllSources () {
    for source in connectedSources {
      MIDIPortDisconnectSource(inputPort, source)
    }
    connectedSources = []
  }

  // MARK: - Hot-plug
  // Called on a CoreMIDI thread
  private func handle (notification: MIDINotification) {
    switch notification.messageID {
    case .msgSetupChanged, .msgObjectAdded, .msgObjectRemoved:
      devicesSetupChanged()
    default:
      break
    }
  }

  private func devicesSetupChanged () {
    queue.async {
      self.devicesNotificationWorkItem?.cancel()
      let workItem = DispatchWorkItem {
        DispatchQueue.main.async {
          self.connectAllSources()
          MIDIManager.devicesChanged.emit(self.devices)
        }
      }
      self.devicesNotificationWorkItem = workItem
      self.queue.asyncAfter(
        deadline: .now() + MIDIManager.devicesDebounceInterval,
        execute: workItem
      )
    }
  }

  // MARK: - Learn
  /// Arms learn mode for a target. The next incoming CC / Note On message
  /// binds and replaces any existing mapping for the same target (and any
  /// mapping already bound to the same physical control). Completion is
  /// invoked exactly once - with the new mapping, or with an error message
  /// on timeout / cancellation - on the serial MIDI queue.
  /// Call on the main thread (DataBus handlers already are).
  func armLearn (target: MIDIMappingTarget, completion: @escaping (MIDIMapping?, String?) -> Void) {
    ensureSetup()
    queue.async {
      // A newer arm replaces a pending one
      if let previous = self.learnCompletion {
        previous(nil, "MIDI Learn was cancelled by a newer Learn request")
      }
      self.learnToken += 1
      let token = self.learnToken
      self.learnTarget = target
      self.learnCompletion = completion

      self.queue.asyncAfter(deadline: .now() + MIDIManager.learnTimeout) {
        guard self.learnToken == token, self.learnCompletion != nil else { return }
        self.learnTarget = nil
        let timedOut = self.learnCompletion
        self.learnCompletion = nil
        timedOut?(nil, "MIDI Learn timed out. No MIDI message was received.")
      }
    }
  }

  func cancelLearn () {
    queue.async {
      self.learnToken += 1
      self.learnTarget = nil
      let completion = self.learnCompletion
      self.learnCompletion = nil
      completion?(nil, "MIDI Learn was cancelled")
    }
  }

  // Queue-confined
  private func bind (target: MIDIMappingTarget, message: MIDIMessage) {
    learnToken += 1
    learnTarget = nil
    let completion = learnCompletion
    learnCompletion = nil

    let source = MIDIMappingSource(
      channel: message.channel,
      kind: message.kind,
      number: message.number
    )
    var mappings = activeMappings
    // A physical control drives only one target
    mappings.removeAll { $0.target != target && $0.source == source }
    // One mapping per target - re-learning updates in place (stable id / row)
    let mapping: MIDIMapping
    if let index = mappings.firstIndex(where: { $0.target == target }) {
      var existing = mappings[index]
      existing.source = source
      mappings[index] = existing
      mapping = existing
    } else {
      mapping = MIDIMapping(id: UUID().uuidString, source: source, target: target)
      mappings.append(mapping)
    }
    // Update the mirror immediately so messages already in flight use the
    // new mapping - the store round trip re-sets it moments later
    activeMappings = mappings

    DispatchQueue.main.async {
      Application.dispatchAction(MIDIAction.setMappings(mappings))
    }
    completion?(mapping, nil)
  }

  // MARK: - Message parsing
  private struct MIDIMessage {
    let channel: Int
    let kind: MIDISourceKind
    let number: Int
    /// CC value or Note On velocity (0-127)
    let value: Int
  }

  // Called on a CoreMIDI thread - parse synchronously (the pointer is only
  // valid for the duration of the callback), then hop to the serial queue
  private func handle (packetList: UnsafePointer<MIDIPacketList>) {
    var messages: [MIDIMessage] = []
    var packet = packetList.pointee.packet
    for _ in 0 ..< packetList.pointee.numPackets {
      let length = Int(packet.length)
      if length > 0 {
        var bytes = [UInt8]()
        bytes.reserveCapacity(length)
        withUnsafeBytes(of: packet.data) { rawBytes in
          for index in 0 ..< min(length, rawBytes.count) {
            bytes.append(rawBytes[index])
          }
        }
        messages.append(contentsOf: MIDIManager.parse(bytes: bytes))
      }
      packet = MIDIPacketNext(&packet).pointee
    }

    guard messages.count > 0 else { return }
    queue.async { self.process(messages: messages) }
  }

  /// Extracts Control Change + Note On messages from a raw MIDI 1.0 byte
  /// stream. Handles running status, skips System Exclusive / Common /
  /// Real-Time messages and Note Offs (incl. Note On with velocity 0).
  private static func parse (bytes rawBytes: [UInt8]) -> [MIDIMessage] {
    // System Real-Time bytes are single-byte messages that may legally
    // interleave ANYWHERE in the stream (even between a status byte and its
    // data) - strip them up front
    let bytes = rawBytes.filter { $0 < 0xF8 }

    var messages: [MIDIMessage] = []
    var index = 0
    var status: UInt8 = 0

    while index < bytes.count {
      let byte = bytes[index]

      if byte == 0xF0 { // System Exclusive - skip until EOX
        index += 1
        while index < bytes.count && bytes[index] != 0xF7 {
          index += 1
        }
        index += 1
        continue
      }
      if byte >= 0xF0 { // Other System Common
        index += 1 + MIDIManager.systemCommonDataLength(byte)
        continue
      }
      if byte >= 0x80 { // New channel status
        status = byte
        index += 1
      } else if status == 0 { // Stray data byte before any status
        index += 1
        continue
      }
      // else: running status - `byte` is the first data byte of `status`

      let type = status & 0xF0
      let channel = Int(status & 0x0F)
      let dataLength = (type == 0xC0 || type == 0xD0) ? 1 : 2
      guard index + dataLength <= bytes.count else { break }
      let data1 = Int(bytes[index] & 0x7F)
      let data2 = dataLength == 2 ? Int(bytes[index + 1] & 0x7F) : 0
      index += dataLength

      switch type {
      case 0xB0: // Control Change
        messages.append(MIDIMessage(channel: channel, kind: .cc, number: data1, value: data2))
      case 0x90: // Note On (velocity 0 == Note Off)
        if data2 > 0 {
          messages.append(MIDIMessage(channel: channel, kind: .note, number: data1, value: data2))
        }
      default:
        break
      }
    }

    return messages
  }

  private static func systemCommonDataLength (_ status: UInt8) -> Int {
    switch status {
    case 0xF1, 0xF3: return 1 // MTC Quarter Frame, Song Select
    case 0xF2: return 2 // Song Position Pointer
    default: return 0
    }
  }

  // MARK: - Message processing (queue-confined)
  private func process (messages: [MIDIMessage]) {
    for message in messages {
      if let target = learnTarget {
        bind(target: target, message: message)
        continue
      }
      guard processingEnabled else { continue }
      handle(message: message)
    }
  }

  private func handle (message: MIDIMessage) {
    for mapping in activeMappings {
      guard mapping.source.kind == message.kind else { continue }
      guard mapping.source.number == message.number else { continue }
      guard mapping.source.channel == -1 || mapping.source.channel == message.channel else { continue }
      apply(mapping: mapping, value: message.value)
    }
  }

  private func apply (mapping: MIDIMapping, value: Int) {
    if mapping.target.isContinuous {
      coalesce(target: mapping.target, value: Double(value))
      return
    }

    // Discrete: Note Ons always fire, CCs fire when crossing 64 upwards
    // (buttons on most controllers send 127 / 0)
    if mapping.source.kind == .note {
      fire(target: mapping.target)
    } else {
      let previous = lastCCValues[mapping.id] ?? 0
      lastCCValues[mapping.id] = value
      if previous < 64 && value >= 64 {
        fire(target: mapping.target)
      }
    }
  }

  // MARK: - Continuous targets (coalesced)
  private func coalesce (target: MIDIMappingTarget, value: Double) {
    pendingValues[target] = value
    guard !flushScheduled.contains(target) else { return }
    flushScheduled.insert(target)
    queue.asyncAfter(deadline: .now() + MIDIManager.coalesceInterval) {
      self.flush(target: target)
    }
  }

  private func flush (target: MIDIMappingTarget) {
    flushScheduled.remove(target)
    guard let value = pendingValues.removeValue(forKey: target) else { return }
    DispatchQueue.main.async {
      self.dispatch(continuousTarget: target, midiValue: value)
    }
  }

  // Main thread
  private func dispatch (continuousTarget target: MIDIMappingTarget, midiValue: Double) {
    switch target {
    case .volume:
      let gain = midiValue.remap(inMin: 0, inMax: 127, outMin: 0, outMax: 1)
      Application.ignoreNextVolumeEvent = true
      Application.ignoreNextDriverMuteEvent = true
      Application.dispatchAction(VolumeAction.setGain(gain, false))
    case .balance:
      let balance = midiValue.remap(inMin: 0, inMax: 127, outMin: -1, outMax: 1)
      Application.ignoreNextVolumeEvent = true
      Application.ignoreNextDriverMuteEvent = true
      Application.dispatchAction(VolumeAction.setBalance(balance, false))
    case .preampGain:
      let gain = midiValue.remap(inMin: 0, inMax: 127, outMin: -24, outMax: 24)
      Application.dispatchAction(PreampAction.setGain(gain))
    default:
      break
    }
  }

  // MARK: - Discrete targets
  private func fire (target: MIDIMappingTarget) {
    DispatchQueue.main.async {
      switch target {
      case .muteToggle:
        Application.ignoreNextVolumeEvent = true
        Application.ignoreNextDriverMuteEvent = true
        Application.dispatchAction(VolumeAction.setMuted(!Application.store.state.volume.muted))
      case .enabledToggle:
        Application.dispatchAction(ApplicationAction.setEnabled(!Application.store.state.enabled))
      case .presetNext:
        self.cyclePreset(step: 1)
      case .presetPrevious:
        self.cyclePreset(step: -1)
      default:
        break
      }
    }
  }

  // Main thread. Not a switch on purpose: future equalizer types (Expert /
  // Graphic 31) can be folded in here without breaking compilation the
  // moment the EqualizerType enum grows. Unknown types are a no-op.
  private func cyclePreset (step: Int) {
    let equalizers = Application.store.state.effects.equalizers

    if equalizers.type == .basic {
      let presets = BasicEqualizer.presets
      guard presets.count > 0 else { return }
      let currentIndex = presets.firstIndex { $0.id == equalizers.basic.selectedPresetId } ?? 0
      let nextIndex = ((currentIndex + step) % presets.count + presets.count) % presets.count
      Application.dispatchAction(BasicEqualizerAction.selectPreset(presets[nextIndex].id, true))
    } else if equalizers.type == .advanced {
      let presets = AdvancedEqualizer.presets
      guard presets.count > 0 else { return }
      let currentIndex = presets.firstIndex { $0.id == equalizers.advanced.selectedPresetId } ?? 0
      let nextIndex = ((currentIndex + step) % presets.count + presets.count) % presets.count
      Application.dispatchAction(AdvancedEqualizerAction.selectPreset(presets[nextIndex].id, true))
    }
  }

  deinit {
    Application.store.unsubscribe(self)
  }
}
