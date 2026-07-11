//
//  RawDSPKernel.swift
//  eqMac
//
//  Raw per-channel DSP infrastructure shared by RawDSPChain and EngineTaps.
//
//  Copyright © 2026 Bitgapp. All rights reserved.
//

import Foundation
import Darwin
import AVFoundation

// MARK: - Kernel base class

/// Base class for raw per-channel DSP kernels executed on the realtime audio
/// render thread by RawDSPChain (inside Engine.renderCallback, BEFORE the
/// CircularBuffer write - so playback, recording and spectrum taps all see
/// fully processed audio).
///
/// Rules for subclasses:
/// - process() MUST be allocation-free and lock-free. Preallocate every
///   buffer / delay line up front.
/// - Parameter updates MUST go through immutable snapshot objects published
///   with AtomicSnapshot (double buffering) - never mutate values the render
///   thread is currently reading.
/// - Never assume a fixed sample rate (44.1k - 192k). The current rate is
///   passed on every process() call - recompute coefficients / delay line
///   sizing lazily when it differs from the last seen rate (sizing itself
///   must still be preallocated for the worst case).
/// - Kernels outlive the Engine: the Engine is destroyed and recreated on
///   device change, sample rate change, jack events, EQ type change and
///   sleep/wake. Owners keep their kernel instance and RawDSPChain re-queries
///   it on every Engine init.
class RawDSPKernel {

  var name: String {
    return String(describing: type(of: self))
  }

  /// When true RawDSPChain skips this kernel entirely.
  /// Single-word flag - safe to toggle from any thread.
  var isBypassed: Bool = false

  /// Inherent latency (lookahead / delay) in frames this kernel introduces.
  /// Summed into Engine.chainLatencyFrames so Output.computeOffset() can
  /// account for it. Owners should call Application.output?.resetOffsets()
  /// after changing it at runtime.
  var latencyFrames: Int = 0

  init () {}

  /// Called on the realtime render thread. Process audio in place.
  /// - Parameters:
  ///   - channelBuffers: one non-interleaved Float32 buffer per channel
  ///   - channelCount: number of valid entries in channelBuffers
  ///   - frameCount: number of valid frames in each channel buffer
  ///   - sampleRate: current engine sample rate
  func process (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double
  ) {
    // Override point. Base implementation is a passthrough.
  }
}

// MARK: - Shared raw DSP helpers

enum RawDSP {
  /// Maximum channel count the raw DSP path supports
  static let maxChannels = 32

  /// Fills `pointers` with one Float32 pointer per non-interleaved channel of
  /// `ioData`, clamping the usable frame count to what every channel buffer
  /// actually holds. Returns nil when the buffer list is not shaped as
  /// non-interleaved Float32 (in which case callers must leave the audio
  /// untouched). Allocation-free - safe on the render thread.
  static func extractChannelPointers (
    _ ioData: UnsafeMutablePointer<AudioBufferList>,
    into pointers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    frameCount: Int
  ) -> (channelCount: Int, frameCount: Int)? {
    let abl = UnsafeMutableAudioBufferListPointer(ioData)
    var channelCount = 0
    var frames = frameCount
    for buffer in abl {
      if channelCount >= maxChannels { break }
      // Interleaved buffers are not supported by the raw DSP path
      guard buffer.mNumberChannels == 1 else { return nil }
      guard let data = buffer.mData else { continue }
      let capacity = Int(buffer.mDataByteSize) / MemoryLayout<Float>.size
      if capacity < frames {
        frames = capacity
      }
      pointers[channelCount] = data.assumingMemoryBound(to: Float.self)
      channelCount += 1
    }
    if channelCount == 0 || frames <= 0 { return nil }
    return (channelCount: channelCount, frameCount: frames)
  }
}

// MARK: - Atomic snapshots

private let AtomicSnapshotCleanupQueue = DispatchQueue(
  label: "com.bitgapp.eqmac.atomic-snapshot-cleanup",
  qos: .utility
)

/// Lock-free publication of immutable snapshot objects to the realtime audio
/// render thread (double-buffered parameter updates, kernel / tap lists).
///
/// - Writers (any non-realtime thread) build a NEW immutable object and call
///   set(). Writers are serialized with a lock the render thread never touches.
/// - The render thread borrows the current snapshot via `value` - a plain
///   atomic pointer load, no locks, no allocations.
/// - Replaced snapshots are kept alive for a grace period (far longer than any
///   render quantum) before being released, so the render thread can never
///   observe a deallocated object. Borrowed values must only be used within
///   the current render cycle.
final class AtomicSnapshot<T: AnyObject> {
  private let cell: UnsafeMutablePointer<UnsafeMutableRawPointer?>
  private let lock = NSLock()
  private var current: T?
  private var retired: [(object: T, retiredAt: TimeInterval)] = []
  private let gracePeriod: TimeInterval

  init (_ initial: T? = nil, gracePeriod: TimeInterval = 1) {
    self.gracePeriod = gracePeriod
    cell = UnsafeMutablePointer<UnsafeMutableRawPointer?>.allocate(capacity: 1)
    cell.initialize(to: nil)
    if initial != nil {
      set(initial)
    }
  }

  /// Publish a new snapshot. NOT for the render thread.
  func set (_ newValue: T?) {
    lock.lock()
    if let old = current {
      retired.append((object: old, retiredAt: Date().timeIntervalSinceReferenceDate))
    }
    current = newValue
    let pointer = newValue.map { Unmanaged.passUnretained($0).toOpaque() }
    atomicStore(pointer)
    lock.unlock()

    AtomicSnapshotCleanupQueue.asyncAfter(deadline: .now() + gracePeriod + 0.1) { [weak self] in
      self?.cleanup()
    }
  }

  /// Borrow the current snapshot without taking ownership.
  /// Safe on the realtime render thread.
  var value: T? {
    guard let pointer = atomicLoad() else { return nil }
    return Unmanaged<T>.fromOpaque(pointer).takeUnretainedValue()
  }

  private func cleanup () {
    lock.lock()
    let now = Date().timeIntervalSinceReferenceDate
    retired.removeAll { now - $0.retiredAt >= gracePeriod }
    lock.unlock()
  }

  private func atomicStore (_ newValue: UnsafeMutableRawPointer?) {
    while true {
      let oldValue = cell.pointee
      if OSAtomicCompareAndSwapPtrBarrier(oldValue, newValue, cell) {
        return
      }
    }
  }

  private func atomicLoad () -> UnsafeMutableRawPointer? {
    let value = cell.pointee
    OSMemoryBarrier()
    return value
  }

  deinit {
    cell.deallocate()
  }
}
