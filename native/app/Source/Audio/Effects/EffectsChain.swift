//
//  EffectsChain.swift
//  eqMac
//
//  Ordered chain of node based Effects that the Engine wires between its
//  inputNode and mainMixerNode.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import AVFoundation

class EffectsChain {

  // MARK: - Registry (INTEGRATION-OWNED from wave 2 onwards)
  //
  // Ordered slot registry - order equals signal flow order:
  //
  //   1. Equalizer slot (always first)
  //   2. Reverb slot
  //   3. Audio Unit hosting slot region
  //
  // Wave 2 effects are wired in with one registration line each, e.g.:
  //
  //   EffectsChain.registerSlot(id: "reverb") { Reverb() }
  //   EffectsChain.registerSlot(id: "audio-units") { Application.audioUnitsHost }
  //
  // Factories run on EVERY Engine init - the Engine is destroyed and
  // recreated on device change, sample rate change, jack events, EQ type
  // change and sleep/wake - so slot effects must fully reconstruct their
  // parameters from the ReSwift store in init (or be long-lived objects whose
  // factory closure returns the same instance). Slots are nil-tolerant: a
  // factory may return nil (owner unavailable) and an Effect may expose no
  // node at all (raw DSP kernel owners) - both are skipped during graph
  // assembly but latency reporting still covers every constructed slot.

  struct SlotRegistration {
    let id: String
    let factory: () -> Effect?
  }

  static var slotRegistrations: [SlotRegistration] = [
    SlotRegistration(id: "equalizers", factory: { Equalizers() })
  ]

  /// Register a slot factory. Appends to the end of the chain, or replaces
  /// in place (keeping chain position) when the id is already registered.
  static func registerSlot (id: String, factory: @escaping () -> Effect?) {
    if let index = slotRegistrations.firstIndex(where: { $0.id == id }) {
      slotRegistrations[index] = SlotRegistration(id: id, factory: factory)
    } else {
      slotRegistrations.append(SlotRegistration(id: id, factory: factory))
    }
  }

  static func unregisterSlot (id: String) {
    slotRegistrations.removeAll { $0.id == id }
  }

  // MARK: - Chain

  private(set) var slots: [Effect] = []

  init () {
    Console.log("Creating EffectsChain")
    slots = EffectsChain.slotRegistrations.compactMap { $0.factory() }
  }

  /// The Equalizers container effect (first slot by convention)
  var equalizers: Equalizers? {
    return slots.first(where: { $0 is Equalizers }) as? Equalizers
  }

  /// AVAudioNodes to wire into the AVAudioEngine graph, in signal flow order.
  /// Effects without any node contribute nothing here.
  var graphNodes: [AVAudioNode] {
    return slots.flatMap { EffectsChain.nodes(for: $0) }
  }

  static func nodes (for effect: Effect) -> [AVAudioNode] {
    // Equalizers is a container - the graph node belongs to the active equalizer
    if let equalizers = effect as? Equalizers {
      if let eq = equalizers.active?.eq {
        return [eq]
      }
      return []
    }
    return effect.nodes
  }

  /// Summed inherent latency (frames) of every effect in the chain.
  /// Feeds Engine.chainLatencyFrames -> Output.computeOffset().
  var totalLatencyFrames: Int {
    return slots.reduce(0) { $0 + ($1.latencyFrames ?? 0) }
  }
}
