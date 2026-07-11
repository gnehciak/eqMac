//
//  CrossfeedKernel.swift
//  eqMac
//
//  bs2b-style headphone crossfeed as a RawDSPKernel: each output channel is
//  the direct signal plus a delayed, low-passed copy of the opposite channel,
//  simulating the interaural crosstalk of listening to loudspeakers.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation

/// Immutable parameter snapshot published to the render thread via
/// AtomicSnapshot. Values are clamped to their valid ranges on construction
/// (the DataBus validates too - this is the last line of defense).
final class CrossfeedKernelParams {
  /// Lowpass cutoff of the cross path in Hz
  static let cutoffRange: ClosedRange<Double> = 300 ... 2000
  /// Attenuation of the cross path relative to the direct path in dB
  /// (bs2b semantics: LOWER value = stronger crossfeed)
  static let levelRange: ClosedRange<Double> = 1 ... 15

  static let defaultCutoff: Double = 700
  static let defaultLevel: Double = 4.5

  let cutoff: Double
  let level: Double

  init (cutoff: Double, level: Double) {
    self.cutoff = min(
      max(cutoff, CrossfeedKernelParams.cutoffRange.lowerBound),
      CrossfeedKernelParams.cutoffRange.upperBound
    )
    self.level = min(
      max(level, CrossfeedKernelParams.levelRange.lowerBound),
      CrossfeedKernelParams.levelRange.upperBound
    )
  }
}

/// Stereo crossfeed kernel.
///
/// Signal flow per output channel (bs2b-style):
///
///   out_L = norm * (in_L + g * LP(delay(in_R)))
///   out_R = norm * (in_R + g * LP(delay(in_L)))
///
/// where:
/// - g     = 10^(-level / 20) - the cross path sits `level` dB below the
///           direct path at low frequencies (bs2b presets: default 700 Hz /
///           4.5 dB, Chu Moy 700 Hz / 6 dB, Jan Meier 650 Hz / 9.5 dB)
/// - LP    = FIRST-ORDER (one-pole, 6 dB/oct) lowpass at `cutoff`.
///           FILTER CHOICE: a one-pole is used instead of the wave-1 Biquad
///           lowPass because the RBJ biquad is 2nd order (12 dB/oct) - twice
///           as steep as the gentle acoustic head-shadowing slope bs2b and
///           analog crossfeed networks (Linkwitz / Moy / Meier) model.
/// - delay = fixed interaural time difference of ~26 samples at 48 kHz
///           (~540 us), scaled linearly with the actual sample rate
/// - norm  = 1 / (1 + g) - renormalization so fully correlated (mono)
///           program material sums back to unity and can never clip
///
/// The direct path is not delayed, so the kernel reports zero latency.
/// All buffers are preallocated for the 192 kHz worst case; process() is
/// allocation-free and lock-free. Coefficients are recomputed lazily on the
/// render thread when the parameter snapshot or the sample rate changes.
class CrossfeedKernel: RawDSPKernel {

  /// ~26 samples at 48 kHz - classic interaural delay used by bs2b
  private static let baseDelaySeconds = 26.0 / 48_000.0
  /// Power-of-two delay line capacity. Worst case delay is 26 * (192000 /
  /// 48000) = 104 frames at 192 kHz - 256 leaves ample headroom.
  private static let delayCapacity = 256
  private static let delayMask = CrossfeedKernel.delayCapacity - 1

  private let params = AtomicSnapshot<CrossfeedKernelParams>(
    CrossfeedKernelParams(
      cutoff: CrossfeedKernelParams.defaultCutoff,
      level: CrossfeedKernelParams.defaultLevel
    )
  )

  // Preallocated delay lines (one per input channel)
  private let delayLineLeft: UnsafeMutablePointer<Float>
  private let delayLineRight: UnsafeMutablePointer<Float>
  private var writeIndex = 0

  // One-pole lowpass state of each cross path
  private var lpStateIntoLeft: Float = 0
  private var lpStateIntoRight: Float = 0

  // Render-thread cached coefficients (rebuilt lazily on param / rate change)
  private var lastParams: CrossfeedKernelParams?
  private var lastSampleRate: Double = 0
  private var lpCoefficient: Float = 0
  private var directGain: Float = 1
  private var crossGain: Float = 0
  private var delayFrames = 1

  override init () {
    delayLineLeft = UnsafeMutablePointer<Float>.allocate(
      capacity: CrossfeedKernel.delayCapacity
    )
    delayLineLeft.initialize(repeating: 0, count: CrossfeedKernel.delayCapacity)
    delayLineRight = UnsafeMutablePointer<Float>.allocate(
      capacity: CrossfeedKernel.delayCapacity
    )
    delayLineRight.initialize(repeating: 0, count: CrossfeedKernel.delayCapacity)
    super.init()
    // Owner enables by clearing this when CrossfeedState.enabled is true
    isBypassed = true
  }

  deinit {
    delayLineLeft.deallocate()
    delayLineRight.deallocate()
  }

  /// Publish new parameters. Any non-realtime thread.
  func setParameters (cutoff: Double, level: Double) {
    params.set(CrossfeedKernelParams(cutoff: cutoff, level: level))
  }

  override func process (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double
  ) {
    // Crossfeed is inherently a stereo effect - channels beyond the first
    // two (and mono streams) pass through untouched.
    guard channelCount >= 2, frameCount > 0 else { return }

    if let newParams = params.value,
       newParams !== lastParams || sampleRate != lastSampleRate {
      recompute(params: newParams, sampleRate: sampleRate)
    }

    let left = channelBuffers[0]
    let right = channelBuffers[1]

    let mask = CrossfeedKernel.delayMask
    let capacity = CrossfeedKernel.delayCapacity
    let delay = delayFrames
    let lpCoeff = lpCoefficient
    let direct = directGain
    let cross = crossGain

    var write = writeIndex
    var lpIntoLeft = lpStateIntoLeft
    var lpIntoRight = lpStateIntoRight

    for frame in 0 ..< frameCount {
      let inLeft = left[frame]
      let inRight = right[frame]

      // Write the dry inputs into the delay lines, then read the delayed
      // opposite-channel samples. delay >= 1, so the read never needs the
      // value being overwritten this frame.
      let index = write & mask
      delayLineLeft[index] = inLeft
      delayLineRight[index] = inRight
      let readIndex = (index - delay + capacity) & mask
      let delayedLeft = delayLineLeft[readIndex]
      let delayedRight = delayLineRight[readIndex]

      // One-pole lowpass each cross path
      lpIntoLeft += lpCoeff * (delayedRight - lpIntoLeft)
      lpIntoRight += lpCoeff * (delayedLeft - lpIntoRight)

      left[frame] = direct * inLeft + cross * lpIntoLeft
      right[frame] = direct * inRight + cross * lpIntoRight

      write += 1
    }

    writeIndex = write & mask

    // Flush denormals / NaNs so the recursion never degrades
    if !lpIntoLeft.isFinite || abs(lpIntoLeft) < Float.leastNormalMagnitude {
      lpIntoLeft = 0
    }
    if !lpIntoRight.isFinite || abs(lpIntoRight) < Float.leastNormalMagnitude {
      lpIntoRight = 0
    }
    lpStateIntoLeft = lpIntoLeft
    lpStateIntoRight = lpIntoRight
  }

  /// Pure math, allocation-free - safe to run on the render thread when the
  /// parameter snapshot or the sample rate changes.
  private func recompute (params: CrossfeedKernelParams, sampleRate: Double) {
    lastParams = params
    lastSampleRate = sampleRate
    let rate = sampleRate > 0 ? sampleRate : 48_000

    delayFrames = min(
      max(Int((CrossfeedKernel.baseDelaySeconds * rate).rounded()), 1),
      CrossfeedKernel.delayCapacity - 1
    )
    // One-pole coefficient: y[n] += a * (x[n] - y[n])
    lpCoefficient = Float(1 - exp(-2 * Double.pi * params.cutoff / rate))

    let cross = pow(10.0, -params.level / 20)
    let norm = 1.0 / (1.0 + cross)
    directGain = Float(norm)
    crossGain = Float(cross * norm)
  }
}
