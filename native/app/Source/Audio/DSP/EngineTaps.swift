//
//  EngineTaps.swift
//  eqMac
//
//  Post-write consumer registry called at the end of Engine.renderCallback
//  with the fully processed audio (post effects chain, post RawDSPChain) that
//  was just committed to the Engine's CircularBuffer. Consumers: recorder,
//  spectrum analyzer FFT etc.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import AVFoundation
import AudioToolbox

// MARK: - Tap base class

/// Base class for post-write audio consumers.
///
/// Rules for subclasses:
/// - consume() runs on the realtime render thread: it MUST be allocation-free
///   and lock-free. Copy frames into your own preallocated ring buffer
///   (e.g. Shared.CircularBuffer) and hand off to a background thread for any
///   real work (file writing, FFT...).
/// - Taps outlive the Engine: the Engine is destroyed and recreated on device
///   change, sample rate change, jack events, EQ type change and sleep/wake.
///   Owners keep their tap instance and EngineTaps re-queries it on every
///   Engine init - handle sample rate changes between consume() calls.
class EngineTap {

  var name: String {
    return String(describing: type(of: self))
  }

  /// When false EngineTaps skips this tap entirely.
  /// Single-word flag - safe to toggle from any thread.
  var isActive: Bool = true

  init () {}

  /// Called on the realtime render thread AFTER the processed audio was
  /// written to the Engine buffer. The audio must be treated as read-only.
  /// - Parameters:
  ///   - channelBuffers: one non-interleaved Float32 buffer per channel
  ///   - channelCount: number of valid entries in channelBuffers
  ///   - frameCount: number of valid frames in each channel buffer
  ///   - sampleRate: current engine sample rate
  ///   - sampleTime: mSampleTime of the first frame in the buffers
  func consume (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double,
    sampleTime: Double
  ) {
    // Override point
  }
}

// MARK: - Registry

class EngineTaps {

  // MARK: - Registration (INTEGRATION-OWNED from wave 2 onwards)
  //
  // Owners register ONCE (at Application setup) with one line each, e.g.:
  //
  //   EngineTaps.register(id: "recorder") { Application.recorder?.tap }
  //   EngineTaps.register(id: "spectrum") { SpectrumAnalyzer.tap }
  //
  // The provider closures are re-run on every Engine init (rebuild() is
  // called from Engine.init) so taps re-attach after the Engine is destroyed
  // and recreated. Providers may return nil while their owner is unavailable.

  struct Registration {
    let id: String
    let provider: () -> EngineTap?
  }

  private static var registrations: [Registration] = []
  private static let registrationLock = NSLock()
  private static let snapshot = AtomicSnapshot<EngineTapsSnapshot>()
  private static let channelPointers =
    UnsafeMutablePointer<UnsafeMutablePointer<Float>>.allocate(capacity: RawDSP.maxChannels)

  /// Register (or replace) a tap provider. NOT for the render thread.
  static func register (id: String, provider: @escaping () -> EngineTap?) {
    registrationLock.lock()
    if let index = registrations.firstIndex(where: { $0.id == id }) {
      registrations[index] = Registration(id: id, provider: provider)
    } else {
      registrations.append(Registration(id: id, provider: provider))
    }
    registrationLock.unlock()
    rebuild()
  }

  /// Remove a tap provider. NOT for the render thread.
  static func unregister (id: String) {
    registrationLock.lock()
    registrations.removeAll { $0.id == id }
    registrationLock.unlock()
    rebuild()
  }

  /// Re-query every registered provider and atomically publish the new tap
  /// list. Called on every Engine init and after (un)registration.
  /// NOT for the render thread.
  static func rebuild () {
    registrationLock.lock()
    let taps = registrations.compactMap { $0.provider() }
    registrationLock.unlock()
    // Touch the lazily initialized static off the render thread
    _ = channelPointers
    snapshot.set(EngineTapsSnapshot(taps: taps))
  }

  // MARK: - Render thread

  /// Feeds the processed audio to every active tap.
  /// Called ONLY from Engine.renderCallback (realtime render thread), after
  /// a successful CircularBuffer.write. Allocation-free and lock-free;
  /// tolerates teardown (empty snapshot) by doing nothing.
  static func process (
    ioData: UnsafeMutablePointer<AudioBufferList>,
    frameCount: UInt32,
    sampleRate: Double,
    sampleTime: Double
  ) {
    guard let taps = snapshot.value?.taps, !taps.isEmpty else { return }
    guard let layout = RawDSP.extractChannelPointers(
      ioData,
      into: channelPointers,
      frameCount: Int(frameCount)
    ) else { return }

    for tap in taps {
      if !tap.isActive { continue }
      tap.consume(
        channelBuffers: channelPointers,
        channelCount: layout.channelCount,
        frameCount: layout.frameCount,
        sampleRate: sampleRate,
        sampleTime: sampleTime
      )
    }
  }
}

/// Immutable tap list published to the render thread
final class EngineTapsSnapshot {
  let taps: [EngineTap]

  init (taps: [EngineTap]) {
    self.taps = taps
  }
}
