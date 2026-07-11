//
//  Effect.swift
//  eqMac
//
//  Created by Roman Kisil on 08/07/2018.
//  Copyright © 2018 Roman Kisil. All rights reserved.
//

import Foundation
import EmitterKit
import AVFoundation

class Effect {
  var node: AVAudioNode!
  var enabledChanged = Event<Bool>()

  /// Nodes this effect contributes to the AVAudioEngine graph, in signal
  /// flow order. Effects hosting multiple units (e.g. an Audio Unit chain)
  /// override this. Effects without any node (raw DSP kernel owners)
  /// return an empty array and are skipped during graph assembly.
  var nodes: [AVAudioNode] {
    if let node = node {
      return [node]
    }
    return []
  }

  /// Inherent latency (lookahead / delay) in frames this effect introduces.
  /// Output.computeOffset() accounts for the summed chain latency so delayed
  /// audio doesn't fall outside the CircularBuffer read window and trigger
  /// CircularBufferError reset loops. nil means no inherent latency. Owners
  /// changing this at runtime should call Application.output?.resetOffsets().
  var latencyFrames: Int?

  var name: String {
    return String(describing: self)
  }
  
  var enabled: Bool = false {
    didSet {
      enabledDidSet()
      enabledChanged.emit(enabled)
    }
  }
  
  func enabledDidSet () {
    if (enabled) {
//      node.
    } else {
//      node.stop()
    }
  }
  
}
