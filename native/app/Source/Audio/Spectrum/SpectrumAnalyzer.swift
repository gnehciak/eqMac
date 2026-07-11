//
//  SpectrumAnalyzer.swift
//  eqMac
//
//  Post-write EngineTap feeding the UI spectrum visualizer.
//
//  consume() (realtime render thread) mixes the processed audio down to mono
//  into a preallocated ring buffer - allocation-free and lock-free. While
//  enabled, a 30 Hz utility-QoS timer performs a 2048 point vDSP FFT (Hann
//  window) over the newest samples, log-bins the magnitudes to 64 bins on the
//  UI's 20 Hz - 20 kHz log axis (dBFS: full scale sine == 0 dB) and hands
//  them to SpectrumDataBus. Frames NEVER go through the ReSwift store.
//
//  Registered with the tap registry by the integration agent:
//
//    EngineTaps.register(id: "spectrum") { SpectrumAnalyzer.tap }
//
//  This file deliberately depends only on EngineTaps.swift (+ Accelerate) so
//  it can be fully type checked and numerically verified standalone.
//

import Foundation
import Accelerate

class SpectrumAnalyzer: EngineTap {
  static let shared = SpectrumAnalyzer()

  /// Provider hook for the EngineTaps registration line
  static var tap: EngineTap? {
    return shared
  }

  static let fftSize = 2048
  static let log2FFTSize: vDSP_Length = 11
  static let binCount = 64
  static let minFrequency: Double = 20
  static let maxFrequency: Double = 20_000
  static let refreshRate: Double = 30
  static let floorDb: Float = -120

  /// Called from the analysis queue ~30 times a second while enabled.
  /// bins are dB values (floorDb ... ~0) on the 64 bin log frequency axis.
  var frameHandler: ((_ bins: [Double], _ sampleRate: Double) -> Void)?

  /// True while a UI subscriber has POSTed /spectrum/enabled true
  private(set) var enabled = false

  // MARK: - Ring buffer (written by the realtime render thread)

  private static let ringSize = 8192 // power of two, > fftSize
  private static let ringMask = SpectrumAnalyzer.ringSize - 1
  private let ring: UnsafeMutablePointer<Float>
  // Monotonically increasing total sample counter - written by the render
  // thread only, read (racily but harmlessly) by the analysis thread
  private var writeIndex: Int = 0
  private var ringSampleRate: Double = 0

  // MARK: - FFT machinery (touched by the analysis queue only)

  private let fftSetup: FFTSetup
  private let window: UnsafeMutablePointer<Float>
  private let input: UnsafeMutablePointer<Float>
  private let windowed: UnsafeMutablePointer<Float>
  private let real: UnsafeMutablePointer<Float>
  private let imag: UnsafeMutablePointer<Float>
  private let magnitudes: UnsafeMutablePointer<Float>
  private let decibels: UnsafeMutablePointer<Float>

  /// Log spaced bin edge frequencies (binCount + 1 values, 20 Hz - 20 kHz)
  private let binEdges: [Double] = {
    var edges = [Double](repeating: 0, count: SpectrumAnalyzer.binCount + 1)
    let ratio = SpectrumAnalyzer.maxFrequency / SpectrumAnalyzer.minFrequency
    for index in 0 ... SpectrumAnalyzer.binCount {
      edges[index] = SpectrumAnalyzer.minFrequency
        * pow(ratio, Double(index) / Double(SpectrumAnalyzer.binCount))
    }
    return edges
  }()

  private let analysisQueue = DispatchQueue(
    label: "com.bitgapp.eqmac.spectrum-analyzer",
    qos: .utility
  )
  private var timer: DispatchSourceTimer?

  override init () {
    let fftSize = SpectrumAnalyzer.fftSize
    let half = fftSize / 2

    ring = UnsafeMutablePointer<Float>.allocate(capacity: SpectrumAnalyzer.ringSize)
    ring.initialize(repeating: 0, count: SpectrumAnalyzer.ringSize)
    window = UnsafeMutablePointer<Float>.allocate(capacity: fftSize)
    input = UnsafeMutablePointer<Float>.allocate(capacity: fftSize)
    input.initialize(repeating: 0, count: fftSize)
    windowed = UnsafeMutablePointer<Float>.allocate(capacity: fftSize)
    windowed.initialize(repeating: 0, count: fftSize)
    real = UnsafeMutablePointer<Float>.allocate(capacity: half)
    real.initialize(repeating: 0, count: half)
    imag = UnsafeMutablePointer<Float>.allocate(capacity: half)
    imag.initialize(repeating: 0, count: half)
    magnitudes = UnsafeMutablePointer<Float>.allocate(capacity: half)
    magnitudes.initialize(repeating: 0, count: half)
    decibels = UnsafeMutablePointer<Float>.allocate(capacity: half)
    decibels.initialize(repeating: 0, count: half)

    vDSP_hann_window(window, vDSP_Length(fftSize), Int32(vDSP_HANN_DENORM))
    fftSetup = vDSP_create_fftsetup(SpectrumAnalyzer.log2FFTSize, FFTRadix(kFFTRadix2))!

    super.init()

    // Skipped by EngineTaps until a UI subscriber enables the spectrum
    isActive = false
  }

  // MARK: - Enable / disable (main thread via SpectrumDataBus)

  func setEnabled (_ enabled: Bool) {
    if (self.enabled == enabled) { return }
    self.enabled = enabled
    // EngineTaps skips inactive taps entirely, so the render thread stops
    // filling the ring buffer while nobody is looking at the spectrum
    isActive = enabled
    if (enabled) {
      startTimer()
    } else {
      stopTimer()
    }
  }

  private func startTimer () {
    stopTimer()
    let timer = DispatchSource.makeTimerSource(queue: analysisQueue)
    let interval = 1.0 / SpectrumAnalyzer.refreshRate
    timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(5))
    timer.setEventHandler { [weak self] in
      self?.analyze()
    }
    timer.resume()
    self.timer = timer
  }

  private func stopTimer () {
    timer?.cancel()
    timer = nil
  }

  // MARK: - Realtime render thread

  override func consume (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double,
    sampleTime: Double
  ) {
    guard channelCount > 0, frameCount > 0 else { return }
    ringSampleRate = sampleRate
    let scale = 1 / Float(channelCount)
    var index = writeIndex
    for frame in 0 ..< frameCount {
      var sample: Float = 0
      for channel in 0 ..< channelCount {
        sample += channelBuffers[channel][frame]
      }
      ring[index & SpectrumAnalyzer.ringMask] = sample * scale
      index += 1
    }
    writeIndex = index
  }

  // MARK: - Analysis (utility QoS timer queue)

  // Internal (not private) so the FFT pipeline can be driven synchronously
  // from verification harnesses
  func analyze () {
    let sampleRate = ringSampleRate
    guard sampleRate > 0 else { return }

    let fftSize = SpectrumAnalyzer.fftSize
    let half = fftSize / 2

    // 1. Copy the newest fftSize samples out of the ring
    let start = writeIndex - fftSize
    for index in 0 ..< fftSize {
      input[index] = ring[(start + index) & SpectrumAnalyzer.ringMask]
    }

    // 2. Hann window
    vDSP_vmul(input, 1, window, 1, windowed, 1, vDSP_Length(fftSize))

    // 3. Real FFT -> power spectrum
    var split = DSPSplitComplex(realp: real, imagp: imag)
    windowed.withMemoryRebound(to: DSPComplex.self, capacity: half) { complexPtr in
      vDSP_ctoz(complexPtr, 2, &split, 1, vDSP_Length(half))
    }
    vDSP_fft_zrip(fftSetup, &split, 1, SpectrumAnalyzer.log2FFTSize, FFTDirection(FFT_FORWARD))
    // Clear the Nyquist value packed into imag[0] so the DC bin stays clean
    split.imagp[0] = 0
    vDSP_zvmags(&split, 1, magnitudes, 1, vDSP_Length(half))

    // 4. Power -> dBFS.
    // vDSP_fft_zrip output is scaled 2x vs the mathematical DFT, and the
    // denormalized Hann window has a coherent gain of 0.5, so a full scale
    // sine peaks at |X| = amplitude * fftSize. Reference power of
    // (fftSize / 2)^2 makes that sine read 0 dB (amplitude counts each of the
    // two half-spectrum lines as fftSize / 2).
    var reference = Float(fftSize / 2) * Float(fftSize / 2)
    // Flag 0 = power quantities: dB = 10 * log10(magnitudes / reference)
    vDSP_vdbcon(magnitudes, 1, &reference, decibels, 1, vDSP_Length(half), 0)

    // 5. Log-bin to the UI's 20 Hz - 20 kHz axis
    let hzPerBin = sampleRate / Double(fftSize)
    var bins = [Double](repeating: Double(SpectrumAnalyzer.floorDb), count: SpectrumAnalyzer.binCount)
    for binIndex in 0 ..< SpectrumAnalyzer.binCount {
      let lowFrequency = binEdges[binIndex]
      let highFrequency = binEdges[binIndex + 1]
      let firstLinear = max(Int(ceil(lowFrequency / hzPerBin)), 1)
      let lastLinear = min(Int(ceil(highFrequency / hzPerBin)) - 1, half - 1)

      var value = SpectrumAnalyzer.floorDb
      if firstLinear <= lastLinear {
        for linear in firstLinear ... lastLinear {
          if decibels[linear] > value {
            value = decibels[linear]
          }
        }
      } else {
        // Log bin narrower than one linear bin - interpolate at its
        // geometric center between the neighbouring linear bins
        let center = (lowFrequency * highFrequency).squareRoot()
        let position = center / hzPerBin
        let lower = Int(position)
        if lower >= half - 1 {
          value = SpectrumAnalyzer.floorDb
        } else if lower < 1 {
          value = decibels[1]
        } else {
          let fraction = Float(position - Double(lower))
          value = decibels[lower] + (decibels[lower + 1] - decibels[lower]) * fraction
        }
      }
      if value < SpectrumAnalyzer.floorDb || !value.isFinite {
        value = SpectrumAnalyzer.floorDb
      }
      // Round to 0.1 dB to keep the 30 Hz push payload small
      bins[binIndex] = (Double(value) * 10).rounded() / 10
    }

    // 6. Hand off to SpectrumDataBus
    frameHandler?(bins, sampleRate)
  }

  deinit {
    stopTimer()
    ring.deallocate()
    window.deallocate()
    input.deallocate()
    windowed.deallocate()
    real.deallocate()
    imag.deallocate()
    magnitudes.deallocate()
    decibels.deallocate()
    vDSP_destroy_fftsetup(fftSetup)
  }
}
