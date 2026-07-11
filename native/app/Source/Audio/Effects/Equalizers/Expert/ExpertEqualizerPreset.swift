//
//  ExpertEqualizerPreset.swift
//  eqMac
//
//  Expert parametric Equalizer Preset model.
//  Follows the AdvancedEqualizerPreset pattern, but instead of fixed band
//  gains a preset carries a fully parametric band list.
//

import Foundation
import SwiftyUserDefaults

struct ExpertEqualizerPresetBand: Codable, DefaultsSerializable, Equatable {
  let id: String
  /// BiquadFilterType raw value:
  /// peak | lowPass | highPass | lowShelf | highShelf | bandPass | notch | allPass
  let type: String
  /// Center / corner frequency in Hz (20 - 20000)
  let frequency: Double
  /// Gain in dB (-24 - 24), used by peak / lowShelf / highShelf
  let gain: Double
  /// Quality factor (0.1 - 10)
  let q: Double
  /// Channel routing: left | right | both
  let channel: String
  let enabled: Bool
}

struct ExpertEqualizerPreset: Codable, DefaultsSerializable {
  let id: String
  let name: String
  let isDefault: Bool
  let bands: [ExpertEqualizerPresetBand]
  let globalGain: Double
}

let EXPERT_EQUALIZER_DEFAULT_PRESETS: [String: [ExpertEqualizerPresetBand]] = [
  "Flat": []
]

extension DefaultsKeys {
  // Effects - Equalizer - Expert
  static let expertEqualizerPresets = DefaultsKey<[ExpertEqualizerPreset]?>("expertEqualizerPresets")
}
