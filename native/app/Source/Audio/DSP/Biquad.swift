//
//  Biquad.swift
//  eqMac
//
//  RBJ Audio EQ Cookbook biquad filters: coefficient computation for all the
//  classic filter shapes plus a per-channel Transposed Direct Form II
//  processing section for use inside RawDSPKernels.
//
//  Reference: Robert Bristow-Johnson, "Cookbook formulae for audio EQ biquad
//  filter coefficients".
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation

enum BiquadFilterType: String, Codable, CaseIterable {
  case peak
  case lowPass
  case highPass
  case lowShelf
  case highShelf
  case bandPass
  case notch
  case allPass
}

/// Normalized (a0 == 1) biquad transfer function coefficients:
///
///   H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
struct BiquadCoefficients {
  var b0: Double
  var b1: Double
  var b2: Double
  var a1: Double
  var a2: Double

  static let passthrough = BiquadCoefficients(b0: 1, b1: 0, b2: 0, a1: 0, a2: 0)

  /// Computes RBJ cookbook coefficients.
  /// - Parameters:
  ///   - type: filter shape
  ///   - frequency: center / corner frequency in Hz (clamped to (1, Nyquist))
  ///   - sampleRate: current sample rate - never assume a fixed one (44.1k-192k)
  ///   - gain: gain in dB, used by peak / lowShelf / highShelf
  ///   - q: quality factor (clamped to a small positive minimum)
  static func compute (
    type: BiquadFilterType,
    frequency: Double,
    sampleRate: Double,
    gain: Double = 0,
    q: Double = 0.7071067811865476
  ) -> BiquadCoefficients {
    guard sampleRate > 0 else { return .passthrough }
    let nyquist = sampleRate / 2
    let clampedFrequency = min(max(frequency, 1), nyquist * 0.999)
    let clampedQ = max(q, 0.001)

    let amp = pow(10, gain / 40)
    let w0 = 2 * Double.pi * clampedFrequency / sampleRate
    let cosW0 = cos(w0)
    let sinW0 = sin(w0)
    let alpha = sinW0 / (2 * clampedQ)

    var b0 = 1.0
    var b1 = 0.0
    var b2 = 0.0
    var a0 = 1.0
    var a1 = 0.0
    var a2 = 0.0

    switch type {
    case .peak:
      b0 = 1 + alpha * amp
      b1 = -2 * cosW0
      b2 = 1 - alpha * amp
      a0 = 1 + alpha / amp
      a1 = -2 * cosW0
      a2 = 1 - alpha / amp
    case .lowPass:
      b0 = (1 - cosW0) / 2
      b1 = 1 - cosW0
      b2 = (1 - cosW0) / 2
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
    case .highPass:
      b0 = (1 + cosW0) / 2
      b1 = -(1 + cosW0)
      b2 = (1 + cosW0) / 2
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
    case .lowShelf:
      let sqrtAmp = sqrt(amp)
      b0 = amp * ((amp + 1) - (amp - 1) * cosW0 + 2 * sqrtAmp * alpha)
      b1 = 2 * amp * ((amp - 1) - (amp + 1) * cosW0)
      b2 = amp * ((amp + 1) - (amp - 1) * cosW0 - 2 * sqrtAmp * alpha)
      a0 = (amp + 1) + (amp - 1) * cosW0 + 2 * sqrtAmp * alpha
      a1 = -2 * ((amp - 1) + (amp + 1) * cosW0)
      a2 = (amp + 1) + (amp - 1) * cosW0 - 2 * sqrtAmp * alpha
    case .highShelf:
      let sqrtAmp = sqrt(amp)
      b0 = amp * ((amp + 1) + (amp - 1) * cosW0 + 2 * sqrtAmp * alpha)
      b1 = -2 * amp * ((amp - 1) + (amp + 1) * cosW0)
      b2 = amp * ((amp + 1) + (amp - 1) * cosW0 - 2 * sqrtAmp * alpha)
      a0 = (amp + 1) - (amp - 1) * cosW0 + 2 * sqrtAmp * alpha
      a1 = 2 * ((amp - 1) - (amp + 1) * cosW0)
      a2 = (amp + 1) - (amp - 1) * cosW0 - 2 * sqrtAmp * alpha
    case .bandPass:
      // Constant 0 dB peak gain variant
      b0 = alpha
      b1 = 0
      b2 = -alpha
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
    case .notch:
      b0 = 1
      b1 = -2 * cosW0
      b2 = 1
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
    case .allPass:
      b0 = 1 - alpha
      b1 = -2 * cosW0
      b2 = 1 + alpha
      a0 = 1 + alpha
      a1 = -2 * cosW0
      a2 = 1 - alpha
    }

    return BiquadCoefficients(
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0
    )
  }

  /// Linear magnitude response |H(e^jw)| at `frequency`.
  /// Useful for frequency response curves and coefficient verification.
  func magnitude (atFrequency frequency: Double, sampleRate: Double) -> Double {
    guard sampleRate > 0 else { return 1 }
    let w = 2 * Double.pi * frequency / sampleRate
    let cos1 = cos(w)
    let cos2 = cos(2 * w)
    let sin1 = sin(w)
    let sin2 = sin(2 * w)
    let realNumerator = b0 + b1 * cos1 + b2 * cos2
    let imagNumerator = -(b1 * sin1 + b2 * sin2)
    let realDenominator = 1 + a1 * cos1 + a2 * cos2
    let imagDenominator = -(a1 * sin1 + a2 * sin2)
    let numerator = sqrt(realNumerator * realNumerator + imagNumerator * imagNumerator)
    let denominator = sqrt(realDenominator * realDenominator + imagDenominator * imagDenominator)
    if denominator == 0 { return 0 }
    return numerator / denominator
  }

  /// Magnitude response in dB at `frequency`
  func gainDb (atFrequency frequency: Double, sampleRate: Double) -> Double {
    return 20 * log10(max(magnitude(atFrequency: frequency, sampleRate: sampleRate), 1e-12))
  }
}

/// One biquad section with per-instance (i.e. per-channel) processing state.
/// Create one instance per channel and process each channel's buffer in place.
///
/// Realtime rules: process() and reset() are allocation-free and safe on the
/// render thread. setCoefficients() must NOT race with process() - publish a
/// new kernel parameter snapshot (fresh Biquad instances, or call
/// setCoefficients only from the render thread itself between blocks) via
/// AtomicSnapshot instead of mutating a section the render thread is
/// currently inside.
final class Biquad {
  private(set) var coefficients: BiquadCoefficients

  // Float32 mirrors of the coefficients for the render loop
  private var b0: Float
  private var b1: Float
  private var b2: Float
  private var a1: Float
  private var a2: Float

  // Transposed Direct Form II state
  private var z1: Float = 0
  private var z2: Float = 0

  init (coefficients: BiquadCoefficients = .passthrough) {
    self.coefficients = coefficients
    b0 = Float(coefficients.b0)
    b1 = Float(coefficients.b1)
    b2 = Float(coefficients.b2)
    a1 = Float(coefficients.a1)
    a2 = Float(coefficients.a2)
  }

  convenience init (
    type: BiquadFilterType,
    frequency: Double,
    sampleRate: Double,
    gain: Double = 0,
    q: Double = 0.7071067811865476
  ) {
    self.init(coefficients: BiquadCoefficients.compute(
      type: type,
      frequency: frequency,
      sampleRate: sampleRate,
      gain: gain,
      q: q
    ))
  }

  /// Swap coefficients, keeping the filter state (no click on small changes)
  func setCoefficients (_ coefficients: BiquadCoefficients) {
    self.coefficients = coefficients
    b0 = Float(coefficients.b0)
    b1 = Float(coefficients.b1)
    b2 = Float(coefficients.b2)
    a1 = Float(coefficients.a1)
    a2 = Float(coefficients.a2)
  }

  /// Clear the filter state (call when the stream restarts / seeks)
  func reset () {
    z1 = 0
    z2 = 0
  }

  /// In-place Transposed Direct Form II processing of one channel buffer.
  /// Allocation-free - safe on the realtime render thread.
  func process (buffer: UnsafeMutablePointer<Float>, frameCount: Int) {
    var state1 = z1
    var state2 = z2
    for frame in 0 ..< frameCount {
      let x = buffer[frame]
      let y = b0 * x + state1
      state1 = b1 * x - a1 * y + state2
      state2 = b2 * x - a2 * y
      buffer[frame] = y
    }
    // Flush denormals / NaNs so the recursion never degrades
    if !state1.isFinite || abs(state1) < Float.leastNormalMagnitude { state1 = 0 }
    if !state2.isFinite || abs(state2) < Float.leastNormalMagnitude { state2 = 0 }
    z1 = state1
    z2 = state2
  }
}
