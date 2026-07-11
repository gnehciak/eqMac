import Foundation
import CoreAudio.AudioServerPlugIn

public let APP_BUNDLE_ID = "com.bitgapp.eqmac"
public let DRIVER_BUNDLE_ID = "com.bitgapp.eqmac.driver"

public struct EQMDeviceCustomProperties: Loopable {
  public let version = AudioObjectPropertySelector.fromString("vrsn")
  public let shown = AudioObjectPropertySelector.fromString("shwn")
  public let latency = AudioObjectPropertySelector.fromString("cltc")
  public let name = AudioObjectPropertySelector.fromString("eqmn")
  // App Mixer - per-app volumes
  // (settable, CFDictionary: bundleId -> { volume, muted })
  public let appVolumes = AudioObjectPropertySelector.fromString("apvl")
  // App Mixer - device client list
  // (read-only, CFArray of CFDictionary: { clientId, processId, bundleId, volume, muted })
  public let clients = AudioObjectPropertySelector.fromString("clts")

  public var count: UInt32 {
    return UInt32(properties.count)
  }
}

public struct EQMDeviceCustomAddresses {
  public var version = AudioObjectPropertyAddress(
    mSelector: EQMDeviceCustom.properties.version,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMaster
  )

  public var shown = AudioObjectPropertyAddress(
    mSelector: EQMDeviceCustom.properties.shown,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMaster
  )

  public var latency = AudioObjectPropertyAddress(
    mSelector: EQMDeviceCustom.properties.latency,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMaster
  )

  public var name = AudioObjectPropertyAddress(
    mSelector: EQMDeviceCustom.properties.name,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMaster
  )

  public var appVolumes = AudioObjectPropertyAddress(
    mSelector: EQMDeviceCustom.properties.appVolumes,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMaster
  )

  public var clients = AudioObjectPropertyAddress(
    mSelector: EQMDeviceCustom.properties.clients,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMaster
  )
}

public struct EQMDeviceCustom {
  public static let properties = EQMDeviceCustomProperties()
  public static var addresses = EQMDeviceCustomAddresses()
}

public let kEQMDeviceSupportedSampleRates: [Float64] = [
  44_100,
  48_000,
  88_200,
  96_000,
  176_400,
  192_000
]

public let kMinVolumeDB: Float32 = -96
public let kMaxVolumeDB: Float32 = 0
