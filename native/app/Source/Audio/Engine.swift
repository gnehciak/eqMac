//
//  Engine.swift
//  eqMac
//
//  Created by Roman Kisil on 10/01/2018.
//  Copyright © 2018 Roman Kisil. All rights reserved.
//

import Cocoa
import AMCoreAudio
//import EventKit
import AVFoundation
import Foundation
import AudioToolbox
import EmitterKit
import Shared

class Engine {

  let engine: AVAudioEngine
  let sources: Sources
  let effects: EffectsChain
  let equalizers: Equalizers
  let format: AVAudioFormat
  let sampleRate: Double

  var lastSampleTime: Double = -1
  var buffer: CircularBuffer<Float>

  /// Total inherent latency (in frames) of the effects chain + raw DSP
  /// kernels. Output.computeOffset() widens the playback safety offset by
  /// this amount so lookahead / delay effects don't trigger
  /// CircularBufferError reset loops.
  var chainLatencyFrames: Int {
    return effects.totalLatencyFrames + RawDSPChain.latencyFrames
  }

  init () {
    Console.log("Creating Engine")
    engine = AVAudioEngine()
    sources = Sources()
    effects = EffectsChain()
    // The Equalizer slot is always present in the chain registry
    equalizers = effects.equalizers!

    // Sink audio into void
    engine.mainMixerNode.outputVolume = 0

    // Setup Buffer
    let framesPerSample = Driver.device!.bufferFrameSize(direction: .playback)
    buffer = CircularBuffer<Float>(channelCount: 2, capacity: Int(framesPerSample) * 2048)

    // Attach Source
    engine.setInputDevice(sources.system.device)
    format = engine.inputNode.inputFormat(forBus: 0)
    sampleRate = format.sampleRate
    Console.log("Set Input Engine format to: \(format.description)")

    // Attach Effects
    let nodes = effects.graphNodes
    for node in nodes {
      engine.attach(node)
    }

    // Chain: inputNode -> effect nodes in slot order -> mainMixerNode
    var lastNode: AVAudioNode = engine.inputNode
    for node in nodes {
      engine.connect(lastNode, to: node, format: format)
      lastNode = node
    }
    engine.connect(lastNode, to: engine.mainMixerNode, format: format)

    // Rebuild the raw DSP kernel chain and the post-write taps from their
    // owners - the Engine is destroyed and recreated on device change,
    // sample rate change, jack events, EQ type change and sleep/wake, so
    // kernels / taps re-attach here from the static registration lists.
    RawDSPChain.rebuild()
    EngineTaps.rebuild()

    // Render callback
    // CRITICAL: the render notify must be attached to the LAST AVAudioUnit
    // in the chain - audio processed by any node after the notify target
    // never reaches the CircularBuffer and silently bypasses the speakers.
    guard let lastAVUnit = nodes.last(where: { $0 is AVAudioUnit }) as? AVAudioUnit else {
      Console.log("ERROR: Effects chain contains no AVAudioUnit to attach the render notify to")
      return
    }
    if lastAVUnit !== nodes.last {
      Console.log("WARNING: Effects chain nodes after the render notify target will not be captured")
    }
    if let err = checkErr(AudioUnitAddRenderNotify(lastAVUnit.audioUnit,
                                                   renderCallback,
                                                   nil)) {
      Console.log(err)
      return
    }

    // Start Engine
    engine.prepare()
    Console.log(engine)
    try! engine.start()
  }

  let renderCallback: AURenderCallback = {
    (inRefCon: UnsafeMutableRawPointer,
     ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
     inTimeStamp:  UnsafePointer<AudioTimeStamp>,
     inBusNumber: UInt32,
     inNumberFrames: UInt32,
     ioData: UnsafeMutablePointer<AudioBufferList>?) -> OSStatus in

    if ioActionFlags.pointee == AudioUnitRenderActionFlags.unitRenderAction_PostRender {
      guard let engine = Application.engine else { return noErr }

      let sampleTime = inTimeStamp.pointee.mSampleTime

      // Raw per-channel DSP (expert EQ biquads, crossfeed, delay, routing,
      // preamp...) runs BEFORE the CircularBuffer write so the playback,
      // recording and spectrum paths downstream all receive fully
      // processed audio.
      RawDSPChain.process(
        ioData: ioData!,
        frameCount: inNumberFrames,
        sampleRate: engine.sampleRate
      )

      let start = sampleTime.int64Value
      let end = start + Int64(inNumberFrames)
      if engine.buffer.write(from: ioData!, start: start, end: end) != .noError {
        return noErr
      }
      engine.lastSampleTime = sampleTime

      // Post-write consumers (recorder, spectrum analyzer...)
      EngineTaps.process(
        ioData: ioData!,
        frameCount: inNumberFrames,
        sampleRate: engine.sampleRate,
        sampleTime: sampleTime
      )
    }

    return noErr
  }
  
  func stop () {
    self.engine.stop()
  }

  deinit {
  }
}
