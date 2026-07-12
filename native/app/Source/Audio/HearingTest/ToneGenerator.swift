//
//  ToneGenerator.swift
//  eqMac
//
//  Created by Romans Kisils on 12/07/2026.
//  Copyright © 2026 Romans Kisils. All rights reserved.
//

import Foundation
import AVFoundation
import Shared

enum ToneGeneratorEar: String {
  case left = "left"
  case right = "right"
}

/// Renders a phase-continuous sine wave into the OUTPUT AVAudioEngine
/// (Application.output!.outputEngine), connected straight into
/// outputEngine.mainMixerNode - i.e. AFTER volume.mixer - so tones bypass
/// the EQ / effects chain (which lives in the input Engine) as well as
/// eqMac's software volume / balance, while still respecting the selected
/// output device. Used by the Hearing Test (HearingTestDataBus).
///
/// Click-free by construction: the per-channel amplitude envelope is slew
/// limited to full-scale per FADE_SECONDS (10ms), so starts, stops, level
/// changes and ear switches all fade instead of stepping, and frequency
/// changes reuse the running phase accumulator (no waveform discontinuity).
class ToneGenerator {
  static let shared = ToneGenerator()

  /// 10ms fade in / out (also the slew bound for every amplitude change)
  static let FADE_SECONDS = 0.010

  /// AVAudioSourceNode is macOS 10.15+ (deployment target is lower)
  static var isSupported: Bool {
    if #available(macOS 10.15, *) {
      return true
    }
    return false
  }

  /// Immutable parameter snapshot published from the control thread and
  /// borrowed by the render thread via AtomicSnapshot (lock-free)
  final class Parameters {
    let frequency: Double
    let leftAmplitude: Double
    let rightAmplitude: Double

    init (frequency: Double, leftAmplitude: Double, rightAmplitude: Double) {
      self.frequency = frequency
      self.leftAmplitude = leftAmplitude
      self.rightAmplitude = rightAmplitude
    }
  }

  /// Mutable state owned exclusively by the render thread
  final private class RenderState {
    var phase: Double = 0
    var leftAmplitude: Double = 0
    var rightAmplitude: Double = 0
  }

  private let parameters = AtomicSnapshot<Parameters>(
    Parameters(frequency: 1_000, leftAmplitude: 0, rightAmplitude: 0)
  )

  // Stored as AVAudioNode so the property compiles below the
  // AVAudioSourceNode (macOS 10.15) availability floor
  private var node: AVAudioNode?
  private weak var attachedOutput: Output?

  private(set) var isPlaying = false

  /// Starts a new tone or retunes the currently playing one.
  /// Lazily attaches the source node to the current Output engine.
  func play (frequency: Double, gainDb: Double, ear: ToneGeneratorEar) throws {
    guard let output = Application.output, Application.engine != nil else {
      throw "Audio engine is not running"
    }

    try attach(to: output)

    let amplitude = pow(10.0, min(max(gainDb, -80), 0) / 20.0)
    parameters.set(Parameters(
      frequency: frequency,
      leftAmplitude: ear == .left ? amplitude : 0,
      rightAmplitude: ear == .right ? amplitude : 0
    ))
    isPlaying = true
  }

  /// Fades the tone out (10ms). The node stays attached, rendering silence,
  /// so the next tone starts instantly without touching the engine graph.
  func stop () {
    let frequency = parameters.value?.frequency ?? 1_000
    parameters.set(Parameters(frequency: frequency, leftAmplitude: 0, rightAmplitude: 0))
    isPlaying = false
  }

  /// Fades out and detaches the source node from the output engine once the
  /// fade has completed. Tolerates the Output / engine having been torn down
  /// already (node.engine goes nil when the owning AVAudioEngine deallocates).
  func teardown () {
    stop()
    guard let node = node else {
      attachedOutput = nil
      return
    }
    self.node = nil
    attachedOutput = nil
    // Give the render thread time to complete the 10ms fade out first
    Async.delay(100) {
      if let engine = node.engine {
        engine.detach(node)
      }
    }
  }

  private func attach (to output: Output) throws {
    if node != nil && attachedOutput === output && node!.engine != nil {
      return
    }

    // Previous node belongs to a different / torn down Output engine
    detachNow()

    guard #available(macOS 10.15, *) else {
      throw "The Hearing Test requires macOS 10.15 (Catalina) or newer"
    }

    let engine = output.outputEngine
    let mixer = engine.mainMixerNode
    var rate = mixer.outputFormat(forBus: 0).sampleRate
    if (rate <= 0) {
      rate = output.device.nominalSampleRate() ?? 44_100
    }
    guard let format = AVAudioFormat(
      standardFormatWithSampleRate: rate,
      channels: 2
    ) else {
      throw "Could not create an audio format for the tone"
    }

    let parameters = self.parameters
    let renderState = RenderState()
    let sampleRate = rate
    let maxDelta = 1.0 / (ToneGenerator.FADE_SECONDS * sampleRate)
    let twoPi = 2.0 * Double.pi

    let source = AVAudioSourceNode(format: format) { isSilence, _, frameCount, audioBufferList -> OSStatus in
      let abl = UnsafeMutableAudioBufferListPointer(audioBufferList)
      let frames = Int(frameCount)

      let params = parameters.value
      let frequency = params?.frequency ?? 1_000
      let targetLeft = params?.leftAmplitude ?? 0
      let targetRight = params?.rightAmplitude ?? 0

      var phase = renderState.phase
      var left = renderState.leftAmplitude
      var right = renderState.rightAmplitude

      let silent = targetLeft == 0 && targetRight == 0
        && left < 0.000_000_1 && right < 0.000_000_1

      let phaseIncrement = twoPi * frequency / sampleRate

      let leftData = abl.count > 0 ? abl[0].mData?.assumingMemoryBound(to: Float.self) : nil
      let rightData = abl.count > 1 ? abl[1].mData?.assumingMemoryBound(to: Float.self) : nil
      // Non-interleaved Float32 per the standard format; zero any extra channels
      if (abl.count > 2) {
        for channel in 2 ..< abl.count {
          if let data = abl[channel].mData {
            memset(data, 0, Int(abl[channel].mDataByteSize))
          }
        }
      }

      func slew (_ current: Double, towards target: Double) -> Double {
        if (current < target) { return min(current + maxDelta, target) }
        if (current > target) { return max(current - maxDelta, target) }
        return current
      }

      for frame in 0 ..< frames {
        left = slew(left, towards: targetLeft)
        right = slew(right, towards: targetRight)
        let sample = sin(phase)
        phase += phaseIncrement
        if (phase >= twoPi) { phase -= twoPi }
        leftData?[frame] = Float(sample * left)
        rightData?[frame] = Float(sample * right)
      }

      renderState.phase = phase
      renderState.leftAmplitude = left
      renderState.rightAmplitude = right

      isSilence.pointee = ObjCBool(silent)
      return noErr
    }

    engine.attach(source)
    engine.connect(
      source,
      to: mixer,
      fromBus: 0,
      toBus: mixer.nextAvailableInputBus,
      format: format
    )

    node = source
    attachedOutput = output
    Console.log("ToneGenerator attached to Output Engine at \(sampleRate)Hz")
  }

  private func detachNow () {
    guard let node = node else {
      attachedOutput = nil
      return
    }
    self.node = nil
    attachedOutput = nil
    if let engine = node.engine {
      engine.detach(node)
    }
  }
}
