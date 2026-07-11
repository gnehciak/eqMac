//
//  Graphic31EqualizerPreset.swift
//  eqMac
//
//  31 Band Graphic Equalizer Preset model.
//  Mechanical clone of the AdvancedEqualizerPreset pattern with 31 band gains.
//

import Foundation
import SwiftyUserDefaults

struct Graphic31EqualizerPreset: Codable, DefaultsSerializable {
  let id: String
  let name: String
  let isDefault: Bool
  let gains: Graphic31EqualizerPresetGains
}

struct Graphic31EqualizerPresetGains: Codable, DefaultsSerializable {
  let global: Double
  let bands: [Double]

  static func == (lhs: Graphic31EqualizerPresetGains, rhs: Graphic31EqualizerPresetGains) -> Bool {
    return lhs.global == rhs.global && lhs.bands == rhs.bands
  }

  static func != (lhs: Graphic31EqualizerPresetGains, rhs: Graphic31EqualizerPresetGains) -> Bool {
    return !(lhs == rhs)
  }
}

extension DefaultsKeys {
  // Effects - Equalizer - Graphic 31
  static let graphic31EqualizerPresets = DefaultsKey<[Graphic31EqualizerPreset]?>("graphic31EqualizerPresets")
}
