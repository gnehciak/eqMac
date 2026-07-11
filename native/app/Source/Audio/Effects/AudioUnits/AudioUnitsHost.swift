//
//  AudioUnitsHost.swift
//  eqMac
//
//  Long-lived host for an ordered chain of third-party Audio Unit effects.
//  Owned by Application (integration instantiates it once, early in start(),
//  and keeps it for the app's lifetime) and plugged into the node based
//  effects chain via:
//
//    EffectsChain.registerSlot(id: "audio-units") { Application.audioUnitsHost }
//
//  The factory returns the SAME instance on every Engine init - the hosted
//  AVAudioUnit nodes survive Engine teardown (they are detached when the old
//  AVAudioEngine deallocates and re-attached by the next Engine's graph
//  assembly loop). Structural changes (add / remove / reorder, and async
//  instantiation completing) emit AudioUnitsHost.needsRebuild, which the
//  integration wiring subscribes to Application's existing
//  Equalizers.typeChanged rebuild flow (stopSave + delayed setupAudio).
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import Cocoa
import AVFoundation
import AudioToolbox
import ReSwift
import EmitterKit
import Shared

/// A single hosted Audio Unit - persisted identity + the live AVAudioUnit
/// instance once async instantiation has finished.
class HostedAudioUnit {
  let id: String
  let componentDescription: AudioComponentDescription
  var name: String
  var manufacturerName: String
  var hasCustomView: Bool
  var enabled: Bool
  var presetData: Data?

  var avAudioUnit: AVAudioUnit?
  var failed = false
  var parameterObserverToken: AUParameterObserverToken?

  var status: String {
    if failed { return "failed" }
    return avAudioUnit == nil ? "loading" : "ready"
  }

  /// Fresh unit picked from the available components list
  init (component: AVAudioUnitComponent) {
    id = UUID().uuidString
    componentDescription = component.audioComponentDescription
    name = component.name
    manufacturerName = component.manufacturerName
    hasCustomView = component.hasCustomView
    enabled = true
    presetData = nil
  }

  /// Unit restored from persisted state. Display metadata not covered by the
  /// persisted schema is refreshed from the component manager - if the
  /// component is no longer installed instantiation will fail and the unit
  /// is surfaced to the UI with status "failed".
  init (record: HostedAudioUnitState) {
    id = record.id
    componentDescription = AudioComponentDescription(
      componentType: record.componentType,
      componentSubType: record.componentSubType,
      componentManufacturer: record.componentManufacturer,
      componentFlags: 0,
      componentFlagsMask: 0
    )
    enabled = record.enabled
    presetData = record.presetData

    let component = AVAudioUnitComponentManager.shared()
      .components(matching: componentDescription)
      .first
    name = component?.name ?? record.name
    manufacturerName = component?.manufacturerName ?? ""
    hasCustomView = component?.hasCustomView ?? false
  }
}

class AudioUnitsHost: Effect {
  // MARK: - Events
  /// Structural chain change that requires an audio pipeline rebuild
  /// (add / remove / reorder / async instantiation finished). Integration
  /// subscribes this to the same flow Equalizers.typeChanged uses in
  /// Application.setupListeners (stopSave + Async.delay(100) + setupAudio).
  static let needsRebuild = EmitterKit.Event<Void>()

  /// Any chain change the UI cares about (also fired for enabled toggles and
  /// instantiation status changes). AudioUnitsDataBus pushes /chain on it.
  static let chainChanged = EmitterKit.Event<Void>()

  /// Application owns the strong reference - this is the access point for
  /// AudioUnitsDataBus, set on init.
  static private(set) weak var shared: AudioUnitsHost?

  // MARK: - Properties
  private(set) var units: [HostedAudioUnit] = []
  private var editorWindows: [String: AudioUnitWindow] = [:]
  private var saveDebouncer: DispatchWorkItem?
  private var terminationObserver: Any?

  var state: AudioUnitsState {
    return Application.store.state.effects.audioUnits
  }

  /// Live AU nodes in signal flow order. Disabled units stay in the graph
  /// (bypassed via auAudioUnit.shouldBypassEffect) so toggling them does not
  /// force a pipeline rebuild. Units still instantiating contribute nothing.
  override var nodes: [AVAudioNode] {
    return units.compactMap { $0.avAudioUnit }
  }

  /// Summed inherent latency of the active hosted units, reported to
  /// EffectsChain.totalLatencyFrames -> Output.computeOffset().
  override var latencyFrames: Int? {
    get {
      let sampleRate = Application.engine?.sampleRate
        ?? Driver.device?.actualSampleRate()
        ?? 44_100
      let seconds = units.reduce(0.0) { total, unit -> Double in
        guard unit.enabled, let auAudioUnit = unit.avAudioUnit?.auAudioUnit else {
          return total
        }
        return total + auAudioUnit.latency
      }
      let frames = Int(seconds * sampleRate)
      return frames > 0 ? frames : nil
    }
    set {
      // Computed from the hosted units - external writes are meaningless
    }
  }

  // MARK: - Initialization
  override init () {
    Console.log("Creating AudioUnitsHost")
    super.init()
    AudioUnitsHost.shared = self
    setupTerminationObserver()
    restoreFromState()
  }

  // MARK: - Enumeration
  static func availableComponents () -> [AVAudioUnitComponent] {
    let description = AudioComponentDescription(
      componentType: kAudioUnitType_Effect,
      componentSubType: 0,
      componentManufacturer: 0,
      componentFlags: 0,
      componentFlagsMask: 0
    )
    return AVAudioUnitComponentManager.shared()
      .components(matching: description)
      .sorted {
        if $0.manufacturerName == $1.manufacturerName {
          return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
        return $0.manufacturerName.localizedCaseInsensitiveCompare($1.manufacturerName) == .orderedAscending
      }
  }

  // MARK: - Chain operations (all called on the main thread by the DataBus)
  func add (
    componentType: UInt32,
    componentSubType: UInt32,
    componentManufacturer: UInt32
  ) throws {
    let description = AudioComponentDescription(
      componentType: componentType,
      componentSubType: componentSubType,
      componentManufacturer: componentManufacturer,
      componentFlags: 0,
      componentFlagsMask: 0
    )
    guard let component = AVAudioUnitComponentManager.shared()
      .components(matching: description)
      .first else {
      throw "Could not find an Audio Unit matching this description on the system"
    }

    let unit = HostedAudioUnit(component: component)
    units.append(unit)
    persistState()
    AudioUnitsHost.chainChanged.emit()

    instantiate(unit) { ready in
      if ready {
        AudioUnitsHost.needsRebuild.emit()
      }
    }
  }

  func remove (id: String) throws {
    guard let index = units.firstIndex(where: { $0.id == id }) else {
      throw "Could not find an Audio Unit with this ID in the chain"
    }
    let unit = units[index]
    closeEditor(id: id)
    unobserveParameters(unit)
    units.remove(at: index)
    persistState()
    AudioUnitsHost.chainChanged.emit()
    if unit.avAudioUnit != nil {
      AudioUnitsHost.needsRebuild.emit()
    }
  }

  func move (id: String, to index: Int) throws {
    guard let currentIndex = units.firstIndex(where: { $0.id == id }) else {
      throw "Could not find an Audio Unit with this ID in the chain"
    }
    let newIndex = min(max(index, 0), units.count - 1)
    if newIndex == currentIndex { return }
    let unit = units.remove(at: currentIndex)
    units.insert(unit, at: newIndex)
    persistState()
    AudioUnitsHost.chainChanged.emit()
    if unit.avAudioUnit != nil {
      AudioUnitsHost.needsRebuild.emit()
    }
  }

  func setEnabled (id: String, enabled: Bool) throws {
    guard let unit = units.first(where: { $0.id == id }) else {
      throw "Could not find an Audio Unit with this ID in the chain"
    }
    unit.enabled = enabled
    unit.avAudioUnit?.auAudioUnit.shouldBypassEffect = !enabled
    persistState()
    AudioUnitsHost.chainChanged.emit()
    // Latency contribution changed - no graph rebuild needed, but the output
    // read offset should be recomputed
    Application.output?.resetOffsets()
  }

  // MARK: - Editor
  func openEditor (id: String) throws {
    guard let unit = units.first(where: { $0.id == id }) else {
      throw "Could not find an Audio Unit with this ID in the chain"
    }
    guard let avAudioUnit = unit.avAudioUnit else {
      throw unit.failed
        ? "This Audio Unit failed to load"
        : "This Audio Unit is still loading, please try again in a moment"
    }
    if let existing = editorWindows[id] {
      existing.focus()
      return
    }
    let editor = AudioUnitWindow(name: unit.name, auAudioUnit: avAudioUnit.auAudioUnit)
    editor.onClose = { [weak self] in
      guard let self = self else { return }
      self.editorWindows.removeValue(forKey: id)
      // Capture whatever the user tweaked in the editor
      self.scheduleStateSave()
    }
    editorWindows[id] = editor
    editor.show()
  }

  func closeEditor (id: String) {
    if let editor = editorWindows[id] {
      editorWindows.removeValue(forKey: id)
      editor.onClose = nil
      editor.close()
    }
  }

  // MARK: - Instantiation
  private func instantiate (_ unit: HostedAudioUnit, _ completion: ((Bool) -> Void)? = nil) {
    AVAudioUnit.instantiate(with: unit.componentDescription, options: []) { [weak self] avAudioUnit, error in
      DispatchQueue.main.async {
        guard let self = self else { return }
        // The unit might have been removed from the chain mid-instantiation
        guard self.units.contains(where: { $0.id == unit.id }) else {
          completion?(false)
          return
        }
        guard error == nil, let avAudioUnit = avAudioUnit else {
          Console.log("AudioUnitsHost: Failed to instantiate '\(unit.name)': \(String(describing: error))")
          unit.failed = true
          AudioUnitsHost.chainChanged.emit()
          completion?(false)
          return
        }
        unit.failed = false
        unit.avAudioUnit = avAudioUnit
        self.applyPresetData(unit)
        avAudioUnit.auAudioUnit.shouldBypassEffect = !unit.enabled
        self.observeParameters(unit)
        AudioUnitsHost.chainChanged.emit()
        completion?(true)
      }
    }
  }

  /// Restore the persisted chain on launch - async instantiate every unit,
  /// then trigger a single pipeline rebuild once they have all settled.
  private func restoreFromState () {
    let persisted = state.units
    if persisted.count == 0 { return }
    Console.log("AudioUnitsHost: Restoring \(persisted.count) Audio Unit(s)")

    var pending = persisted.count
    var anyReady = false
    for record in persisted {
      let unit = HostedAudioUnit(record: record)
      units.append(unit)
      instantiate(unit) { ready in
        anyReady = anyReady || ready
        pending -= 1
        if pending == 0 && anyReady {
          AudioUnitsHost.needsRebuild.emit()
        }
      }
    }
  }

  // MARK: - Preset data (auAudioUnit.fullState <-> Data)
  private func applyPresetData (_ unit: HostedAudioUnit) {
    guard let presetData = unit.presetData, let auAudioUnit = unit.avAudioUnit?.auAudioUnit else {
      return
    }
    guard let fullState = (
      try? PropertyListSerialization.propertyList(from: presetData, options: [], format: nil)
    ) as? [String: Any] else {
      Console.log("AudioUnitsHost: Could not deserialize preset data for '\(unit.name)'")
      return
    }
    auAudioUnit.fullState = fullState
  }

  private func captureFullState () {
    for unit in units {
      guard let auAudioUnit = unit.avAudioUnit?.auAudioUnit else { continue }
      guard let fullState = auAudioUnit.fullState else { continue }
      if let data = try? PropertyListSerialization.data(
        fromPropertyList: fullState,
        format: .binary,
        options: 0
      ) {
        unit.presetData = data
      }
    }
  }

  // MARK: - Parameter observation (feeds the debounced fullState save)
  private func observeParameters (_ unit: HostedAudioUnit) {
    guard let tree = unit.avAudioUnit?.auAudioUnit.parameterTree else { return }
    unit.parameterObserverToken = tree.token(byAddingParameterObserver: { [weak self] _, _ in
      // Called on an arbitrary (possibly realtime adjacent) queue at knob-drag
      // rate - only bounce a debounced save to the main queue, never touch
      // the store from here
      DispatchQueue.main.async {
        self?.scheduleStateSave()
      }
    })
  }

  private func unobserveParameters (_ unit: HostedAudioUnit) {
    if let token = unit.parameterObserverToken,
      let tree = unit.avAudioUnit?.auAudioUnit.parameterTree {
      tree.removeParameterObserver(token)
    }
    unit.parameterObserverToken = nil
  }

  // MARK: - Persistence
  private func unitStates () -> [HostedAudioUnitState] {
    return units.map { unit in
      HostedAudioUnitState(
        id: unit.id,
        componentType: unit.componentDescription.componentType,
        componentSubType: unit.componentDescription.componentSubType,
        componentManufacturer: unit.componentDescription.componentManufacturer,
        name: unit.name,
        enabled: unit.enabled,
        presetData: unit.presetData
      )
    }
  }

  private func persistState () {
    Application.dispatchAction(AudioUnitsAction.setUnits(unitStates()))
  }

  /// Debounced fullState capture + persist. Parameter observers can fire at
  /// drag rate, so the store is only touched after 1s of silence.
  func scheduleStateSave () {
    saveDebouncer?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self = self else { return }
      self.saveDebouncer = nil
      self.captureFullState()
      self.persistState()
    }
    saveDebouncer = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: work)
  }

  /// Synchronous save - used on app termination where async dispatched
  /// blocks would never run.
  func saveStateNow () {
    saveDebouncer?.cancel()
    saveDebouncer = nil
    captureFullState()
    // Deliberately NOT dispatchAction: we are on the main thread during
    // termination and the async main queue hop would be lost
    Application.store.dispatch(AudioUnitsAction.setUnits(unitStates()))
    Storage.synchronize()
  }

  private func setupTerminationObserver () {
    terminationObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.willTerminateNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.saveStateNow()
    }
  }

  deinit {
    if let observer = terminationObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }
}
