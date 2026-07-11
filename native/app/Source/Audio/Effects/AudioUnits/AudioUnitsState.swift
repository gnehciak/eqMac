//
//  AudioUnitsState.swift
//  eqMac
//
//  Persisted state for the hosted third-party Audio Unit chain.
//  Mounted on EffectsState by the integration wiring:
//
//    @DefaultCodable<AudioUnitsStateDefault> var audioUnits = AudioUnitsStateDefault.defaultValue
//    state.audioUnits = AudioUnitsStateReducer(action: action, state: state.audioUnits)
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import ReSwift
import SwiftyUserDefaults
import BetterCodable

/// One hosted Audio Unit in the chain, in signal flow order.
/// The component is identified by its AudioComponentDescription triple
/// (OSType FourCC codes stored as UInt32). `presetData` is the
/// auAudioUnit.fullState dictionary archived with PropertyListSerialization
/// (binary format) - nil until the first debounced capture.
struct HostedAudioUnitState: Codable, DefaultsSerializable, Equatable {
  var id: String
  var componentType: UInt32
  var componentSubType: UInt32
  var componentManufacturer: UInt32
  var name: String
  var enabled: Bool
  var presetData: Data?
}

// Strategy for the integration agent to mount this substate on EffectsState
// without breaking decoding of previously persisted ApplicationState JSON:
// @DefaultCodable<AudioUnitsStateDefault> var audioUnits = AudioUnitsStateDefault.defaultValue
struct AudioUnitsStateDefault: DefaultCodableStrategy {
  static var defaultValue = AudioUnitsState()
}

struct AudioUnitsState: State {
  @DefaultEmptyArray var units: [HostedAudioUnitState] = []
}

enum AudioUnitsAction: Action {
  case setUnits([HostedAudioUnitState])
}

func AudioUnitsStateReducer (action: Action, state: AudioUnitsState?) -> AudioUnitsState {
  var state = state ?? AudioUnitsState()

  switch action as? AudioUnitsAction {
  case .setUnits(let units)?:
    state.units = units
  case .none:
    break
  }

  return state
}
