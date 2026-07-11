//
//  ChannelDelayKernel.swift
//  eqMac
//
//  Independent left / right channel delay (0 - 30 ms) as a RawDSPKernel.
//  Useful for time-aligning asymmetric speaker placements.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation

/// Immutable parameter snapshot published to the render thread via
/// AtomicSnapshot. Values are clamped to their valid range on construction
/// (the DataBus validates too - this is the last line of defense).
final class ChannelDelayKernelParams {
  /// Per-channel delay range in milliseconds
  static let delayMsRange: ClosedRange<Double> = 0 ... 30

  let leftMs: Double
  let rightMs: Double

  init (leftMs: Double, rightMs: Double) {
    self.leftMs = min(
      max(leftMs, ChannelDelayKernelParams.delayMsRange.lowerBound),
      ChannelDelayKernelParams.delayMsRange.upperBound
    )
    self.rightMs = min(
      max(rightMs, ChannelDelayKernelParams.delayMsRange.lowerBound),
      ChannelDelayKernelParams.delayMsRange.upperBound
    )
  }
}

/// Per-channel delay kernel.
///
/// Each channel owns a preallocated ring buffer sized for 0.5 s at 192 kHz
/// (96,000 frames, rounded up to the 2^17 = 131,072 power of two for cheap
/// index masking). A parameter change never reallocates anything - it only
/// moves the read offset relative to the write head.
///
/// The maximum of the two delays is reported through latencyFrames (summed
/// into Engine.chainLatencyFrames -> Output.computeOffset). The owner keeps
/// it up to date off the render thread using delayFrames(ms:sampleRate:);
/// the kernel also self-corrects it lazily when it observes a sample rate
/// change on the render thread (plain Int store - no locks).
///
/// process() is allocation-free and lock-free. Channels beyond the first two
/// (and the ring buffers themselves on mono streams) pass through untouched.
class ChannelDelayKernel: RawDSPKernel {

  /// 0.5 s per channel at 192 kHz = 96,000 frames -> next power of two
  private static let capacity = 1 << 17
  private static let mask = ChannelDelayKernel.capacity - 1

  private let params = AtomicSnapshot<ChannelDelayKernelParams>(
    ChannelDelayKernelParams(leftMs: 0, rightMs: 0)
  )

  // Preallocated ring buffers (channel 0 = left, channel 1 = right)
  private let ringLeft: UnsafeMutablePointer<Float>
  private let ringRight: UnsafeMutablePointer<Float>
  private var writeIndex = 0

  // Render-thread cached values (rebuilt lazily on param / rate change)
  private var lastParams: ChannelDelayKernelParams?
  private var lastSampleRate: Double = 0
  private var leftDelayFrames = 0
  private var rightDelayFrames = 0

  override init () {
    ringLeft = UnsafeMutablePointer<Float>.allocate(
      capacity: ChannelDelayKernel.capacity
    )
    ringLeft.initialize(repeating: 0, count: ChannelDelayKernel.capacity)
    ringRight = UnsafeMutablePointer<Float>.allocate(
      capacity: ChannelDelayKernel.capacity
    )
    ringRight.initialize(repeating: 0, count: ChannelDelayKernel.capacity)
    super.init()
    // Owner enables by clearing this when ChannelDelayState.enabled is true
    isBypassed = true
  }

  deinit {
    ringLeft.deallocate()
    ringRight.deallocate()
  }

  /// Delay in frames for a given delay in ms at a given sample rate - the
  /// single source of truth used both by the render thread and by the owner
  /// for latency reporting, so the two always agree.
  static func delayFrames (ms: Double, sampleRate: Double) -> Int {
    guard sampleRate > 0 else { return 0 }
    return min(
      max(Int((ms / 1000 * sampleRate).rounded()), 0),
      ChannelDelayKernel.capacity - 1
    )
  }

  /// Publish new parameters. Any non-realtime thread.
  func setParameters (leftMs: Double, rightMs: Double) {
    params.set(ChannelDelayKernelParams(leftMs: leftMs, rightMs: rightMs))
  }

  override func process (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double
  ) {
    guard channelCount >= 1, frameCount > 0 else { return }

    if let newParams = params.value,
       newParams !== lastParams || sampleRate != lastSampleRate {
      recompute(params: newParams, sampleRate: sampleRate)
    }

    processChannel(
      buffer: channelBuffers[0],
      ring: ringLeft,
      delay: leftDelayFrames,
      frameCount: frameCount
    )
    if channelCount >= 2 {
      processChannel(
        buffer: channelBuffers[1],
        ring: ringRight,
        delay: rightDelayFrames,
        frameCount: frameCount
      )
    }

    writeIndex = (writeIndex + frameCount) & ChannelDelayKernel.mask
  }

  private func processChannel (
    buffer: UnsafeMutablePointer<Float>,
    ring: UnsafeMutablePointer<Float>,
    delay: Int,
    frameCount: Int
  ) {
    let mask = ChannelDelayKernel.mask
    let capacity = ChannelDelayKernel.capacity
    var write = writeIndex
    for frame in 0 ..< frameCount {
      let index = write & mask
      // Write first, then read: a delay of 0 reads the value just written
      // and is an exact passthrough, while the ring still fills so a later
      // delay increase reads real audio instead of silence.
      ring[index] = buffer[frame]
      buffer[frame] = ring[(index - delay + capacity) & mask]
      write += 1
    }
  }

  /// Pure math, allocation-free - safe to run on the render thread when the
  /// parameter snapshot or the sample rate changes.
  private func recompute (params: ChannelDelayKernelParams, sampleRate: Double) {
    lastParams = params
    lastSampleRate = sampleRate
    leftDelayFrames = ChannelDelayKernel.delayFrames(
      ms: params.leftMs, sampleRate: sampleRate
    )
    rightDelayFrames = ChannelDelayKernel.delayFrames(
      ms: params.rightMs, sampleRate: sampleRate
    )
    // Self-correct the reported latency in case the owner's estimate was
    // computed against a different (or unknown) sample rate. Plain Int
    // store - safe from the render thread.
    latencyFrames = max(leftDelayFrames, rightDelayFrames)
  }
}
