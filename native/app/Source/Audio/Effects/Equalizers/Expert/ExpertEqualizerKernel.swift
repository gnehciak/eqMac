//
//  ExpertEqualizerKernel.swift
//  eqMac
//
//  Raw DSP kernel of the Expert parametric Equalizer.
//
//  Builds per-channel Biquad cascades from the selected preset's band list.
//  Parameter changes are published as immutable snapshots (AtomicSnapshot) and
//  applied to a persistent, preallocated pool of Biquad sections ON the render
//  thread between blocks - so coefficient updates never race process() while
//  the filter state (z1/z2) survives parameter changes without clicks.
//
//  Registered with the raw DSP chain by the integration agent:
//
//    RawDSPChain.register(id: "expert-equalizer") { ExpertEqualizer.kernel }
//
//  This file deliberately depends only on Biquad.swift + RawDSPKernel.swift
//  (no Codable preset model, no Application) so it can be fully type checked
//  and numerically verified standalone.
//

import Foundation

/// Channel routing target of a single Expert Equalizer band
enum ExpertEqualizerKernelBandChannel: String {
  case left
  case right
  case both
}

/// Parameter description of a single Expert Equalizer band, decoupled from
/// the Codable preset model (ExpertEqualizer maps preset bands to these)
struct ExpertEqualizerKernelBand {
  let id: String
  let type: BiquadFilterType
  let frequency: Double
  let gain: Double
  let q: Double
  let channel: ExpertEqualizerKernelBandChannel
  let enabled: Bool
}

/// Immutable parameter snapshot published to the render thread.
/// `coefficients` / `computedSampleRate` are only mutated by the builder
/// BEFORE publication or by the render thread AFTER publication (single
/// consumer), so they need no further synchronization.
final class ExpertEqualizerKernelSnapshot {
  struct Band {
    let type: BiquadFilterType
    let frequency: Double
    let gain: Double
    let q: Double
    let channel: ExpertEqualizerKernelBandChannel
    /// true when this pool row was assigned a different band than in the
    /// previously built snapshot - its filter state must be cleared before use
    let resetState: Bool
  }

  /// Monotonically increasing build number - lets the render thread detect a
  /// new snapshot without relying on object identity
  let generation: UInt64
  let bands: [Band]
  let globalGainMultiplier: Float

  var coefficients: [BiquadCoefficients]
  var computedSampleRate: Double = 0

  init (generation: UInt64, bands: [Band], globalGainMultiplier: Float) {
    self.generation = generation
    self.bands = bands
    self.globalGainMultiplier = globalGainMultiplier
    self.coefficients = Array(repeating: BiquadCoefficients.passthrough, count: bands.count)
  }

  /// Recompute every band's coefficients for `sampleRate`.
  /// Allocation-free - safe to call lazily from the realtime render thread
  /// when the engine sample rate differs from the snapshot's.
  func computeCoefficients (sampleRate: Double) {
    for index in 0 ..< bands.count {
      let band = bands[index]
      coefficients[index] = BiquadCoefficients.compute(
        type: band.type,
        frequency: band.frequency,
        sampleRate: sampleRate,
        gain: band.gain,
        q: band.q
      )
    }
    computedSampleRate = sampleRate
  }
}

class ExpertEqualizerKernel: RawDSPKernel {
  /// Soft cap on simultaneously processed bands - bands beyond it are ignored
  static let maxBands = 64

  private let snapshot = AtomicSnapshot<ExpertEqualizerKernelSnapshot>()

  // Persistent per-band (row), per-channel (column) biquad sections.
  // Preallocated once; only the render thread touches them after that, which
  // keeps the filter state continuous across parameter snapshot swaps.
  private let pool: [[Biquad]]

  // Render thread bookkeeping
  private var appliedGeneration: UInt64 = 0
  private var appliedSampleRate: Double = 0

  // Builder bookkeeping (parameter thread, i.e. main) for reset detection
  private var lastBuiltBandIds: [String] = []
  private var buildGeneration: UInt64 = 0

  override init () {
    var pool: [[Biquad]] = []
    pool.reserveCapacity(ExpertEqualizerKernel.maxBands)
    for _ in 0 ..< ExpertEqualizerKernel.maxBands {
      var row: [Biquad] = []
      row.reserveCapacity(RawDSP.maxChannels)
      for _ in 0 ..< RawDSP.maxChannels {
        row.append(Biquad())
      }
      pool.append(row)
    }
    self.pool = pool
    super.init()
  }

  /// Publish a new parameter snapshot. NOT for the render thread - call from
  /// the parameter (main) thread only. Disabled bands are dropped here so
  /// they cost nothing at render time.
  /// - Parameter sampleRateHint: current engine sample rate if known (> 0) -
  ///   lets the coefficients be precomputed off the render thread. When 0 the
  ///   render thread computes them lazily on the next process() call.
  func setParameters (
    bands: [ExpertEqualizerKernelBand],
    globalGain: Double,
    sampleRateHint: Double = 0
  ) {
    let active = Array(
      bands.lazy.filter { $0.enabled }.prefix(ExpertEqualizerKernel.maxBands)
    )
    let snapshotBands = active.enumerated().map { index, band -> ExpertEqualizerKernelSnapshot.Band in
      let reset = index >= lastBuiltBandIds.count || lastBuiltBandIds[index] != band.id
      return ExpertEqualizerKernelSnapshot.Band(
        type: band.type,
        frequency: band.frequency,
        gain: band.gain,
        q: band.q,
        channel: band.channel,
        resetState: reset
      )
    }
    lastBuiltBandIds = active.map { $0.id }
    buildGeneration += 1

    let newSnapshot = ExpertEqualizerKernelSnapshot(
      generation: buildGeneration,
      bands: snapshotBands,
      globalGainMultiplier: Float(pow(10.0, globalGain / 20.0))
    )
    if sampleRateHint > 0 {
      newSnapshot.computeCoefficients(sampleRate: sampleRateHint)
    }
    snapshot.set(newSnapshot)
  }

  override func process (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double
  ) {
    guard let current = snapshot.value,
          channelCount > 0,
          frameCount > 0,
          sampleRate > 0
    else { return }

    // Recompute coefficients lazily when the engine sample rate differs from
    // the snapshot's (allocation-free, in place)
    if current.computedSampleRate != sampleRate {
      current.computeCoefficients(sampleRate: sampleRate)
    }

    // Apply the snapshot to the persistent biquad pool when it (or the
    // sample rate) changed since the last render cycle
    if appliedGeneration != current.generation || appliedSampleRate != sampleRate {
      let isNewSnapshot = appliedGeneration != current.generation
      for index in 0 ..< current.bands.count {
        let coefficients = current.coefficients[index]
        let row = pool[index]
        let reset = isNewSnapshot && current.bands[index].resetState
        for channel in 0 ..< RawDSP.maxChannels {
          row[channel].setCoefficients(coefficients)
          if reset {
            row[channel].reset()
          }
        }
      }
      appliedGeneration = current.generation
      appliedSampleRate = sampleRate
    }

    // Per-band channel routing:
    // left  -> channel 0 only
    // right -> channel 1 only (skipped for mono streams)
    // both  -> all channels
    for index in 0 ..< current.bands.count {
      let row = pool[index]
      switch current.bands[index].channel {
      case .left:
        row[0].process(buffer: channelBuffers[0], frameCount: frameCount)
      case .right:
        if channelCount > 1 {
          row[1].process(buffer: channelBuffers[1], frameCount: frameCount)
        }
      case .both:
        let channels = min(channelCount, RawDSP.maxChannels)
        for channel in 0 ..< channels {
          row[channel].process(buffer: channelBuffers[channel], frameCount: frameCount)
        }
      }
    }

    // Global gain
    let multiplier = current.globalGainMultiplier
    if multiplier != 1 {
      for channel in 0 ..< channelCount {
        let buffer = channelBuffers[channel]
        for frame in 0 ..< frameCount {
          buffer[frame] *= multiplier
        }
      }
    }
  }
}
