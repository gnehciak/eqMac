//
//  RoutingKernel.swift
//  eqMac
//
//  Stereo routing matrix (mono downmix, channel swap, single-channel to
//  both) as a RawDSPKernel. First kernel in the raw DSP chain so every
//  downstream effect sees the rerouted image.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import Accelerate

/// Raw values are the wire contract of POST /effects/routing/mode
enum RoutingMode: String, Codable, CaseIterable {
  case stereo
  case monoDownmix
  case swap
  case leftToBoth
  case rightToBoth
}

/// Immutable parameter snapshot published to the render thread via
/// AtomicSnapshot.
final class RoutingKernelParams {
  let mode: RoutingMode

  init (mode: RoutingMode) {
    self.mode = mode
  }
}

/// Routing kernel - trivial copy / average operations, allocation-free:
///
/// - stereo:       passthrough (no work at all)
/// - monoDownmix:  L = R = (L + R) / 2 (vDSP_vasm into the scratch buffer)
/// - swap:         L <-> R via the preallocated scratch buffer
/// - leftToBoth:   R = L
/// - rightToBoth:  L = R
///
/// Operates on the first two channels only; anything beyond (and mono
/// streams) passes through untouched. Buffers larger than the scratch
/// capacity are handled in chunks - still allocation-free.
class RoutingKernel: RawDSPKernel {

  /// Small preallocated scratch used by swap / monoDownmix. Render quanta
  /// are typically <= 4096 frames; larger buffers just loop in chunks.
  private static let scratchCapacity = 8192

  private let scratch: UnsafeMutablePointer<Float>

  private let params = AtomicSnapshot<RoutingKernelParams>(
    RoutingKernelParams(mode: .stereo)
  )

  override init () {
    scratch = UnsafeMutablePointer<Float>.allocate(
      capacity: RoutingKernel.scratchCapacity
    )
    scratch.initialize(repeating: 0, count: RoutingKernel.scratchCapacity)
    super.init()
    // Owner enables by clearing this when RoutingState.enabled is true
    isBypassed = true
  }

  deinit {
    scratch.deallocate()
  }

  /// Publish a new routing mode. Any non-realtime thread.
  func setMode (_ mode: RoutingMode) {
    params.set(RoutingKernelParams(mode: mode))
  }

  override func process (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double
  ) {
    guard channelCount >= 2, frameCount > 0 else { return }
    let mode = params.value?.mode ?? .stereo

    let left = channelBuffers[0]
    let right = channelBuffers[1]
    let floatSize = MemoryLayout<Float>.size

    switch mode {
    case .stereo:
      return

    case .leftToBoth:
      memcpy(right, left, frameCount * floatSize)

    case .rightToBoth:
      memcpy(left, right, frameCount * floatSize)

    case .monoDownmix:
      var half: Float = 0.5
      var offset = 0
      while offset < frameCount {
        let chunk = min(RoutingKernel.scratchCapacity, frameCount - offset)
        // scratch = (L + R) * 0.5
        vDSP_vasm(
          left + offset, 1,
          right + offset, 1,
          &half,
          scratch, 1,
          vDSP_Length(chunk)
        )
        memcpy(left + offset, scratch, chunk * floatSize)
        memcpy(right + offset, scratch, chunk * floatSize)
        offset += chunk
      }

    case .swap:
      var offset = 0
      while offset < frameCount {
        let chunk = min(RoutingKernel.scratchCapacity, frameCount - offset)
        let bytes = chunk * floatSize
        memcpy(scratch, left + offset, bytes)
        memcpy(left + offset, right + offset, bytes)
        memcpy(right + offset, scratch, bytes)
        offset += chunk
      }
    }
  }
}
