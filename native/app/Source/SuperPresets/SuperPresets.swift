//
//  SuperPresets.swift
//  eqMac
//
//  Super Presets engine - watches the selected output device and the
//  frontmost application and automatically switches the Equalizer type +
//  preset when a rule matches. App rules take precedence over device rules.
//  If a matched rule has `revert` set, the EQ type + preset that were active
//  before the rule fired are restored once the trigger clears.
//
//  An instance is created by Application setup, which also wires the state
//  accessors (see getState / getSelectedPresetId below).
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import Cocoa
import ReSwift
import EmitterKit

class SuperPresets: StoreSubscriber {
  // MARK: - Integration wiring
  /// Wired by Application setup so this class can read the persisted
  /// Super Presets state without hard coupling to ApplicationState:
  ///
  ///   SuperPresets.getState = { Application.store.state.superPresets }
  static var getState: () -> SuperPresetsState = { SuperPresetsState() }

  /// Returns the currently selected preset id for an EqualizerType raw value.
  /// The default implementation covers the substates that exist on
  /// EqualizersState at the time this package was written. Application setup
  /// replaces it once the Expert / Graphic31 substates are mounted:
  ///
  ///   SuperPresets.getSelectedPresetId = { type in
  ///     let eq = Application.store.state.effects.equalizers
  ///     switch type {
  ///     case "Basic": return eq.basic.selectedPresetId
  ///     case "Advanced": return eq.advanced.selectedPresetId
  ///     case "Expert": return eq.expert.selectedPresetId
  ///     case "Graphic31": return eq.graphic31.selectedPresetId
  ///     default: return nil
  ///     }
  ///   }
  static var getSelectedPresetId: (String) -> String? = { type in
    let equalizers = Application.store.state.effects.equalizers
    switch type {
    case EqualizerType.basic.rawValue: return equalizers.basic.selectedPresetId
    case EqualizerType.advanced.rawValue: return equalizers.advanced.selectedPresetId
    default: return nil
    }
  }

  // MARK: - Events
  // Static so SuperPresetsDataBus can push UI events without needing the
  // engine instance.
  static let enabledChanged = EmitterKit.Event<Bool>()
  static let rulesChanged = EmitterKit.Event<[SuperPresetRule]>()

  // App switches are chatty (activation events can fire in bursts) so
  // evaluation is debounced.
  static let APP_SWITCH_DEBOUNCE_MS = 300
  static let DEVICE_SWITCH_DEBOUNCE_MS = 500

  // MARK: - Properties
  private struct Baseline {
    let equalizerType: String
    let presetId: String?
  }

  /// Bundle ID of the last activated regular application (never our own)
  private var frontmostBundleId: String?

  /// The rule currently applied, if any
  private var activeRule: SuperPresetRule?

  /// EQ type + preset that were selected before the first rule fired -
  /// restored on trigger clear when the rule has `revert` set
  private var baseline: Baseline?

  // Last observed values - newState fires on every store action, so only
  // react / emit when something actually changed.
  private var appliedEnabled: Bool?
  private var appliedRules: [SuperPresetRule]?

  // MARK: - Listeners
  // Strong references - EmitterKit listeners stop listening when deallocated.
  private var outputCreatedListener: EventListener<Void>?
  private var outputChangedListener: EventListener<AudioDevice>?
  private var workspaceObserver: NSObjectProtocol?
  private var evaluationWorkItem: DispatchWorkItem?

  private var currentDeviceUID: String? {
    return Application.selectedDevice?.uid
  }

  // MARK: - Initialization
  init () {
    Console.log("Creating SuperPresets")

    frontmostBundleId = { () -> String? in
      guard let app = NSWorkspace.shared.frontmostApplication,
        let bundleId = app.bundleIdentifier,
        bundleId != Application.bundleId else { return nil }
      return bundleId
    }()

    setupDeviceListeners()
    setupWorkspaceListener()
    applyState(SuperPresets.getState())
    setupStateListener()
  }

  // MARK: - State
  typealias StoreSubscriberStateType = ApplicationState

  private func setupStateListener () {
    // Subscribes to the whole tree (rather than .select-ing the substate)
    // so this file compiles before the superPresets substate is mounted on
    // ApplicationState. applyState only reacts to actual changes.
    Application.store.subscribe(self)
  }

  func newState (state: ApplicationState) {
    applyState(SuperPresets.getState())
  }

  private func applyState (_ state: SuperPresetsState) {
    var changed = false

    if state.enabled != appliedEnabled {
      let isFirstObservation = appliedEnabled == nil
      appliedEnabled = state.enabled
      if !isFirstObservation {
        SuperPresets.enabledChanged.emit(state.enabled)
      }
      changed = true
    }

    if state.rules != appliedRules {
      let isFirstObservation = appliedRules == nil
      appliedRules = state.rules
      if !isFirstObservation {
        SuperPresets.rulesChanged.emit(state.rules)
      }
      changed = true
    }

    if changed {
      if state.enabled {
        scheduleEvaluation(after: 0)
      } else {
        // Feature switched off - treat as a trigger clear
        evaluationWorkItem?.cancel()
        applyMatch(nil)
      }
    }
  }

  // MARK: - Triggers
  private func setupDeviceListeners () {
    // Fires every time the audio pipeline is (re)created with the newly
    // selected output device - covers device selection, device removal
    // fallback, jack events, sample rate changes and sleep / wake.
    outputCreatedListener = Application.outputCreated.on { [weak self] in
      self?.scheduleEvaluation(after: 0)
    }

    // Fires when the default system output changes - covers the case where
    // eqMac processing is disabled but the user still switches devices.
    // retain: false keeps this listener out of AudioDeviceEvents' static
    // registry (which is wiped on every AudioDeviceEvents.stop()) - we hold
    // it strongly ourselves instead so it survives pipeline teardowns.
    outputChangedListener = AudioDeviceEvents.on(.outputChanged, retain: false) { [weak self] device in
      if let driverId = Driver.device?.id, device.id == driverId { return }
      self?.scheduleEvaluation(after: SuperPresets.DEVICE_SWITCH_DEBOUNCE_MS)
    }
  }

  private func setupWorkspaceListener () {
    workspaceObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let self = self else { return }
      guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
        let bundleId = app.bundleIdentifier else { return }
      // Ignore our own activations - opening the eqMac popover must not
      // clear an app trigger
      if bundleId == Application.bundleId { return }
      if bundleId == self.frontmostBundleId { return }
      self.frontmostBundleId = bundleId
      self.scheduleEvaluation(after: SuperPresets.APP_SWITCH_DEBOUNCE_MS)
    }
  }

  private func scheduleEvaluation (after milliseconds: Int) {
    evaluationWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      self?.evaluate()
    }
    evaluationWorkItem = workItem
    DispatchQueue.main.asyncAfter(
      deadline: .now() + .milliseconds(milliseconds),
      execute: workItem
    )
  }

  // MARK: - Evaluation
  private func evaluate () {
    let state = SuperPresets.getState()
    guard state.enabled else {
      applyMatch(nil)
      return
    }

    var matched: SuperPresetRule?

    // App rules take precedence over device rules
    if let bundleId = frontmostBundleId {
      matched = state.rules.first(where: {
        $0.trigger.kind == "app" && $0.trigger.bundleId == bundleId
      })
    }

    if matched == nil, let deviceUID = currentDeviceUID {
      matched = state.rules.first(where: {
        $0.trigger.kind == "device" && $0.trigger.deviceUID == deviceUID
      })
    }

    applyMatch(matched)
  }

  private func applyMatch (_ rule: SuperPresetRule?) {
    if rule == activeRule { return }

    if let rule = rule {
      if activeRule == nil {
        // Transitioning from no match to a match - remember what the user
        // had selected so it can be restored when the trigger clears
        let currentType = Application.store.state.effects.equalizers.type.rawValue
        baseline = Baseline(
          equalizerType: currentType,
          presetId: SuperPresets.getSelectedPresetId(currentType)
        )
      }
      activeRule = rule
      Console.log("SuperPresets: Rule matched, switching to \(rule.equalizerType) / \(rule.presetId)")
      apply(equalizerType: rule.equalizerType, presetId: rule.presetId)
    } else {
      let previousRule = activeRule
      let previousBaseline = baseline
      activeRule = nil
      baseline = nil
      if let previousRule = previousRule, previousRule.revert, let restore = previousBaseline {
        Console.log("SuperPresets: Trigger cleared, reverting to \(restore.equalizerType) / \(restore.presetId ?? "current")")
        apply(equalizerType: restore.equalizerType, presetId: restore.presetId)
      }
    }
  }

  private func apply (equalizerType: String, presetId: String?) {
    let equalizers = Application.store.state.effects.equalizers

    if equalizers.type.rawValue != equalizerType {
      guard let type = EqualizerType(rawValue: equalizerType) else {
        Console.log("SuperPresets: Unknown Equalizer type '\(equalizerType)', skipping")
        return
      }
      // Triggers the full pipeline rebuild - same path as the user
      // switching the EQ type manually
      Application.dispatchAction(EqualizersAction.setType(type))
    }

    guard let presetId = presetId else { return }
    if SuperPresets.getSelectedPresetId(equalizerType) == presetId { return }

    switch equalizerType {
    case "Basic":
      Application.dispatchAction(BasicEqualizerAction.selectPreset(presetId, true))
    case "Advanced":
      Application.dispatchAction(AdvancedEqualizerAction.selectPreset(presetId, true))
    case "Expert":
      Application.dispatchAction(ExpertEqualizerAction.selectPreset(presetId, true))
    case "Graphic 31":
      Application.dispatchAction(Graphic31EqualizerAction.selectPreset(presetId, true))
    default:
      break
    }
  }

  deinit {
    if let observer = workspaceObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(observer)
    }
    workspaceObserver = nil
    evaluationWorkItem?.cancel()
    Application.store.unsubscribe(self)
  }
}
