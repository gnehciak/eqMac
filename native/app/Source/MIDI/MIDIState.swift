//
//  MIDIState.swift
//  eqMac
//
//  Persisted state for MIDI controller support.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

// MARK: - Mapping model

enum MIDISourceKind: String, Codable {
  case cc = "cc"
  case note = "note"
}

enum MIDIMappingTarget: String, Codable, CaseIterable {
  case volume = "volume"
  case balance = "balance"
  case preampGain = "preampGain"
  case presetNext = "presetNext"
  case presetPrevious = "presetPrevious"
  case muteToggle = "muteToggle"
  case enabledToggle = "enabledToggle"

  /// Continuous targets remap the 7-bit CC value onto the target's range and
  /// are coalesced to <= 30Hz. Discrete targets fire on note-on / CC value
  /// crossing 64 upwards.
  var isContinuous: Bool {
    switch self {
    case .volume, .balance, .preampGain:
      return true
    case .presetNext, .presetPrevious, .muteToggle, .enabledToggle:
      return false
    }
  }
}

struct MIDIMappingSource: Codable, Equatable {
  /// 0-15, or -1 for "any channel"
  var channel: Int = -1
  var kind: MIDISourceKind = .cc
  /// Controller / note number 0-127
  var number: Int = 0
}

struct MIDIMapping: Codable, Equatable {
  var id: String = UUID().uuidString
  var source: MIDIMappingSource = MIDIMappingSource()
  var target: MIDIMappingTarget = .volume
}

// MARK: - State

fileprivate struct MIDIMappingsDefault: DefaultCodableStrategy {
  static var defaultValue: [MIDIMapping] = []
}

/// Default strategy for the whole substate. The integration agent uses it in
/// ApplicationState so old persisted state trees keep decoding:
///
///   @DefaultCodable<MIDIStateDefault> var midi = MIDIStateDefault.value
struct MIDIStateDefault: DefaultCodableStrategy {
  static var defaultValue = MIDIState()
}

struct MIDIState: State {
  @DefaultFalse var enabled = false
  @DefaultCodable<MIDIMappingsDefault> var mappings = MIDIMappingsDefault.value
}

// MARK: - Actions

enum MIDIAction: Action {
  case setEnabled(Bool)
  case setMappings([MIDIMapping])
}

// MARK: - Reducer

func MIDIStateReducer (action: Action, state: MIDIState?) -> MIDIState {
  var state = state ?? MIDIState()

  switch action as? MIDIAction {
  case .setEnabled(let enabled)?:
    state.enabled = enabled
  case .setMappings(let mappings)?:
    state.mappings = mappings
  case .none:
    break
  }

  return state
}
