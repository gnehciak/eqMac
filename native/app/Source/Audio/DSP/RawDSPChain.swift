//
//  RawDSPChain.swift
//  eqMac
//
//  Lock-free, preallocated chain of raw per-channel DSP kernels invoked from
//  Engine.renderCallback on ioData BEFORE the CircularBuffer write, so the
//  playback path AND the post-write taps (recorder, spectrum) downstream all
//  capture fully processed audio.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import AVFoundation
import AudioToolbox

class RawDSPChain {

  // MARK: - Registration (INTEGRATION-OWNED from wave 2 onwards)
  //
  // Ordered registration list - registration order equals processing order:
  //
  //   routing -> expert EQ -> crossfeed -> delay -> preamp
  //
  // Owners register ONCE (at Application setup) with one line each, e.g.:
  //
  //   RawDSPChain.register(id: "routing") { Application.routing?.kernel }
  //   RawDSPChain.register(id: "expert-equalizer") { ExpertEqualizer.kernel }
  //   RawDSPChain.register(id: "crossfeed") { Application.crossfeed?.kernel }
  //   RawDSPChain.register(id: "delay") { Application.delay?.kernel }
  //   RawDSPChain.register(id: "preamp") { Application.preamp?.kernel }
  //
  // The provider closures are re-run on every Engine init (rebuild() is called
  // from Engine.init) so kernels re-attach after the Engine is destroyed and
  // recreated on device change, sample rate change, jack events, EQ type
  // change and sleep/wake. Providers may return nil while their owner is
  // unavailable (e.g. during teardown) - they are simply skipped.

  struct Registration {
    let id: String
    let provider: () -> RawDSPKernel?
  }

  private static var registrations: [Registration] = []
  private static let registrationLock = NSLock()
  private static let snapshot = AtomicSnapshot<RawDSPChainSnapshot>()
  private static let channelPointers =
    UnsafeMutablePointer<UnsafeMutablePointer<Float>>.allocate(capacity: RawDSP.maxChannels)

  /// Register (or replace, keeping chain position) a kernel provider.
  /// NOT for the render thread.
  static func register (id: String, provider: @escaping () -> RawDSPKernel?) {
    registrationLock.lock()
    if let index = registrations.firstIndex(where: { $0.id == id }) {
      registrations[index] = Registration(id: id, provider: provider)
    } else {
      registrations.append(Registration(id: id, provider: provider))
    }
    registrationLock.unlock()
    rebuild()
  }

  /// Remove a kernel provider. NOT for the render thread.
  static func unregister (id: String) {
    registrationLock.lock()
    registrations.removeAll { $0.id == id }
    registrationLock.unlock()
    rebuild()
  }

  /// Re-query every registered provider and atomically publish the new kernel
  /// list. Called on every Engine init and after (un)registration.
  /// NOT for the render thread.
  static func rebuild () {
    registrationLock.lock()
    let kernels = registrations.compactMap { $0.provider() }
    registrationLock.unlock()
    // Touch the lazily initialized static off the render thread
    _ = channelPointers
    snapshot.set(RawDSPChainSnapshot(kernels: kernels))
  }

  /// Summed inherent latency (frames) of all active (non-bypassed) kernels
  static var latencyFrames: Int {
    guard let kernels = snapshot.value?.kernels else { return 0 }
    return kernels.reduce(0) { $0 + ($1.isBypassed ? 0 : $1.latencyFrames) }
  }

  // MARK: - Render thread

  /// Runs every kernel in order, in place on ioData.
  /// Called ONLY from Engine.renderCallback (realtime render thread).
  /// Allocation-free and lock-free; tolerates teardown (empty snapshot,
  /// nil Application.engine) by doing nothing.
  static func process (
    ioData: UnsafeMutablePointer<AudioBufferList>,
    frameCount: UInt32,
    sampleRate: Double
  ) {
    guard let kernels = snapshot.value?.kernels, !kernels.isEmpty else { return }
    guard let layout = RawDSP.extractChannelPointers(
      ioData,
      into: channelPointers,
      frameCount: Int(frameCount)
    ) else { return }

    for kernel in kernels {
      if kernel.isBypassed { continue }
      kernel.process(
        channelBuffers: channelPointers,
        channelCount: layout.channelCount,
        frameCount: layout.frameCount,
        sampleRate: sampleRate
      )
    }
  }
}

/// Immutable kernel list published to the render thread
final class RawDSPChainSnapshot {
  let kernels: [RawDSPKernel]

  init (kernels: [RawDSPKernel]) {
    self.kernels = kernels
  }
}
