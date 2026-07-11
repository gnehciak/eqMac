//
//  Recorder.swift
//  eqMac
//
//  Records the fully processed audio stream (post effects chain, post
//  RawDSPChain - the same signal that is committed to the Engine's
//  CircularBuffer, intentionally excluding output side volume / boost)
//  into an M4A / AAC file.
//
//  RecorderTap.consume() runs on the realtime render thread and ONLY copies
//  frames into a dedicated CircularBuffer (allocation and lock free). A
//  utility QoS drain timer pulls the frames back out of the ring and feeds
//  them to AVAudioFile, which transparently AAC encodes the Float32 input.
//
//  The tap outlives the Engine - EngineTaps re-queries the provider on every
//  Engine recreation (device change, sample rate change, jack events, EQ
//  type change, sleep / wake) so a recording survives teardowns: while no
//  Engine exists no frames arrive and the recording simply pauses. When the
//  sample rate changes mid-recording the current segment is closed and a
//  numbered continuation file is started (simplest correct behaviour).
//
//  Instantiated by Application (Application.recorder = Recorder()) and
//  registered with the tap registry by the integration agent:
//
//    EngineTaps.register(id: "recorder") { Application.recorder?.tap }
//

import Foundation
import AVFoundation
import AudioToolbox
import Shared

// MARK: - Status

struct RecorderStatus {
  let recording: Bool
  let seconds: Double
  let path: String?
}

// MARK: - Realtime tap

class RecorderTap: EngineTap {
  static let channels = 2
  // 262144 frames per channel = ~5.9s at 44.1kHz / ~1.4s at 192kHz of
  // headroom for the 10Hz drain timer (2MB of Float32 total)
  static let ringCapacity = 262144

  // The ring is (re)allocated by prepare() on the control thread while
  // isActive == false, so the render thread never observes a half built one.
  private(set) var ring: CircularBuffer<Float>?

  // Written by the render thread only, read (racily but harmlessly - single
  // word loads, same approach as SpectrumAnalyzer.writeIndex) by the drain
  // thread. Monotonic since prepare(), independent of the engine's
  // mSampleTime so Engine recreations never move it backwards.
  private(set) var framesWritten: Int64 = 0
  // Sample rate of the most recently consumed frames
  private(set) var sampleRate: Double = 0
  // Position (in framesWritten space) at which `sampleRate` came into
  // effect. -1 while the rate has not changed since capture started.
  private(set) var rateBoundary: Int64 = -1

  // Preallocated ABL pointed at the tap's channel buffers on every
  // consume() call - keeps the render thread allocation free
  private let abl = AudioBufferList.allocate(maximumBuffers: RecorderTap.channels)

  override init () {
    super.init()
    // EngineTaps skips inactive taps entirely - zero render thread cost
    // while not recording
    isActive = false
  }

  /// Reset the counters and allocate a fresh ring.
  /// Control thread only, and only while isActive == false.
  func prepare (sampleRate: Double) {
    framesWritten = 0
    rateBoundary = -1
    self.sampleRate = sampleRate
    ring = CircularBuffer<Float>(
      channelCount: RecorderTap.channels,
      capacity: RecorderTap.ringCapacity
    )
  }

  /// Release the ring. Control thread only, and only while isActive == false.
  func teardown () {
    ring = nil
  }

  /// Drain thread, after every pre-rate-change frame has been consumed
  func clearRateBoundary () {
    rateBoundary = -1
  }

  override func consume (
    channelBuffers: UnsafeMutablePointer<UnsafeMutablePointer<Float>>,
    channelCount: Int,
    frameCount: Int,
    sampleRate: Double,
    sampleTime: Double
  ) {
    guard let ring = ring, channelCount > 0, frameCount > 0 else { return }

    if sampleRate > 0 && sampleRate != self.sampleRate {
      // Frames from framesWritten onwards are at the new rate. The drain
      // thread finishes the current segment up to this boundary, then
      // rotates to a numbered continuation file.
      rateBoundary = framesWritten
      self.sampleRate = sampleRate
    }

    // Point the preallocated ABL at the tap buffers. A mono stream feeds
    // both ring channels, channels above 2 are dropped.
    for channel in 0 ..< RecorderTap.channels {
      let source = channelBuffers[min(channel, channelCount - 1)]
      abl[channel].mNumberChannels = 1
      abl[channel].mDataByteSize = UInt32(frameCount * MemoryLayout<Float>.stride)
      abl[channel].mData = UnsafeMutableRawPointer(source)
    }

    let start = framesWritten
    let end = start + Int64(frameCount)
    if ring.write(from: abl.unsafePointer, start: start, end: end) == .noError {
      framesWritten = end
    }
  }

  deinit {
    free(abl.unsafeMutablePointer)
  }
}

// MARK: - Recorder

class Recorder {
  static let defaultFolderName = "eqMac Recordings"
  static let drainChunkFrames: AVAudioFrameCount = 8192
  static let drainIntervalMs = 100

  let tap = RecorderTap()

  /// Called on start / stop transitions and at 1Hz while recording.
  /// Fired from the utility drain queue - hop to main before touching the
  /// Bridge.
  var statusHandler: ((RecorderStatus) -> Void)?

  private(set) var isRecording = false
  // Path of the segment currently being written (or the last one finished)
  private(set) var currentPath: String?
  private var secondsRecorded: Double = 0

  private var file: AVAudioFile?
  private var pcmBuffer: AVAudioPCMBuffer?
  private var readPosition: Int64 = 0
  private var baseName = ""
  private var segmentIndex = 1
  // Folder captured at start() so continuation segments stay next to the
  // first one even if the user changes the destination mid-recording
  private var recordingFolder = Recorder.defaultDestination

  // All control path work (start / stop / drain / rotate) is serialized on
  // this queue - the render thread only ever touches RecorderTap
  private let drainQueue = DispatchQueue(
    label: "com.bitgapp.eqmac.recorder",
    qos: .utility
  )
  private var drainTimer: DispatchSourceTimer?
  private var statusTimer: DispatchSourceTimer?

  init () {}

  var status: RecorderStatus {
    return RecorderStatus(
      recording: isRecording,
      seconds: secondsRecorded,
      path: currentPath
    )
  }

  // MARK: - Destination

  static var defaultDestination: URL {
    let fileManager = FileManager.default
    let music = fileManager.urls(for: .musicDirectory, in: .userDomainMask).first
      ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Music", isDirectory: true)
    return music.appendingPathComponent(Recorder.defaultFolderName, isDirectory: true)
  }

  /// Effective destination folder - the persisted custom folder or the default
  var destination: URL {
    if let custom = Application.store.state.recorder.destinationFolder, custom != "" {
      return URL(fileURLWithPath: custom, isDirectory: true)
    }
    return Recorder.defaultDestination
  }

  // MARK: - Start / Stop (any thread, serialized on drainQueue)

  func start () throws {
    try drainQueue.sync {
      if isRecording {
        throw "Already recording"
      }
      guard let engine = Application.engine else {
        throw "Audio is not running yet. Please try again in a moment."
      }
      let sampleRate = engine.sampleRate
      let folder = destination
      do {
        try FileManager.default.createDirectory(
          at: folder,
          withIntermediateDirectories: true,
          attributes: nil
        )
      } catch {
        throw "Could not create the recordings folder at \(folder.path)"
      }

      let formatter = DateFormatter()
      formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
      baseName = "eqMac \(formatter.string(from: Date()))"
      segmentIndex = 1
      recordingFolder = folder
      let url = nextSegmentURL(folder: folder)

      let newFile = try Recorder.createFile(url: url, sampleRate: sampleRate)
      file = newFile
      pcmBuffer = AVAudioPCMBuffer(
        pcmFormat: newFile.processingFormat,
        frameCapacity: Recorder.drainChunkFrames
      )
      currentPath = url.path
      secondsRecorded = 0
      readPosition = 0

      tap.prepare(sampleRate: sampleRate)
      isRecording = true
      tap.isActive = true

      startTimers()
      Console.log("Recorder: recording to \(url.path) at \(sampleRate)Hz")
      notifyStatus()
    }
  }

  /// Stops capturing, drains whatever is left in the ring, finalizes the
  /// file and calls back (on the main queue) with the final segment's path.
  func stop (_ completion: @escaping (String?) -> Void) {
    drainQueue.async {
      guard self.isRecording || self.file != nil else {
        DispatchQueue.main.async { completion(self.currentPath) }
        return
      }
      self.isRecording = false
      self.tap.isActive = false
      self.stopTimers()

      // Drain everything still in the ring, including a pending sample rate
      // boundary rotation. Bail out if a write error stops progress.
      var lastRead: Int64 = -1
      while self.readPosition < self.tap.framesWritten && self.readPosition != lastRead {
        lastRead = self.readPosition
        self.drain()
      }

      let path = self.currentPath
      self.finalize()
      Console.log("Recorder: recording finished - \(path ?? "no file")")
      self.notifyStatus()
      DispatchQueue.main.async { completion(path) }
    }
  }

  // MARK: - File management (drainQueue only)

  private static func createFile (url: URL, sampleRate: Double) throws -> AVAudioFile {
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: RecorderTap.channels,
      AVEncoderBitRateKey: 256000
    ]
    do {
      return try AVAudioFile(
        forWriting: url,
        settings: settings,
        commonFormat: .pcmFormatFloat32,
        interleaved: false
      )
    } catch {
      throw "Could not create the recording file. "
        + "The AAC encoder might not support the current sample rate (\(Int(sampleRate))Hz)."
    }
  }

  private func nextSegmentURL (folder: URL) -> URL {
    while true {
      let suffix = segmentIndex > 1 ? " (\(segmentIndex))" : ""
      let url = folder.appendingPathComponent("\(baseName)\(suffix).m4a")
      if !FileManager.default.fileExists(atPath: url.path) {
        return url
      }
      segmentIndex += 1
    }
  }

  /// Sample rate changed mid-recording: finalize the current segment and
  /// continue into a numbered continuation file at the new rate.
  private func startContinuationSegment () {
    let sampleRate = tap.sampleRate
    file = nil // Finalizes the finished segment
    pcmBuffer = nil
    segmentIndex += 1
    let url = nextSegmentURL(folder: recordingFolder)
    do {
      let newFile = try Recorder.createFile(url: url, sampleRate: sampleRate)
      file = newFile
      pcmBuffer = AVAudioPCMBuffer(
        pcmFormat: newFile.processingFormat,
        frameCapacity: Recorder.drainChunkFrames
      )
      currentPath = url.path
      Console.log("Recorder: sample rate changed to \(sampleRate)Hz - continuing in \(url.lastPathComponent)")
    } catch {
      // The AAC encoder rejected the new sample rate - stop the recording
      // and keep what was captured so far
      Console.log("Recorder: \(error.localizedDescription) - stopping recording")
      isRecording = false
      tap.isActive = false
      stopTimers()
      finalize()
      notifyStatus()
    }
  }

  private func finalize () {
    file = nil // AVAudioFile finalizes the container when released
    pcmBuffer = nil
    tap.teardown()
  }

  // MARK: - Drain (drainQueue only)

  private func drain () {
    // Rotate to a continuation segment once every pre-change frame has been
    // written after a sample rate change
    if tap.rateBoundary >= 0 && readPosition >= tap.rateBoundary {
      tap.clearRateBoundary()
      startContinuationSegment()
    }

    guard let ring = tap.ring, let file = file, let pcmBuffer = pcmBuffer else {
      return
    }

    var target = tap.framesWritten
    let boundary = tap.rateBoundary
    if boundary >= 0 && boundary < target {
      // Finish the current segment first - frames past the boundary are at
      // the new sample rate and belong to the continuation file
      target = boundary
    }

    let segmentRate = file.processingFormat.sampleRate
    while readPosition < target {
      let chunk = min(target - readPosition, Int64(pcmBuffer.frameCapacity))
      pcmBuffer.frameLength = AVAudioFrameCount(chunk)
      if ring.read(
        into: pcmBuffer.mutableAudioBufferList,
        from: readPosition,
        to: readPosition + chunk
      ) != .noError {
        break
      }
      do {
        try file.write(from: pcmBuffer)
      } catch {
        Console.log("Recorder: failed to write audio - \(error.localizedDescription)")
        break
      }
      readPosition += chunk
      secondsRecorded += Double(chunk) / segmentRate
    }
  }

  // MARK: - Timers (created / cancelled on drainQueue)

  private func startTimers () {
    stopTimers()

    let drainTimer = DispatchSource.makeTimerSource(queue: drainQueue)
    drainTimer.schedule(
      deadline: .now() + .milliseconds(Recorder.drainIntervalMs),
      repeating: .milliseconds(Recorder.drainIntervalMs),
      leeway: .milliseconds(20)
    )
    drainTimer.setEventHandler { [weak self] in
      self?.drain()
    }
    drainTimer.resume()
    self.drainTimer = drainTimer

    let statusTimer = DispatchSource.makeTimerSource(queue: drainQueue)
    statusTimer.schedule(deadline: .now() + 1, repeating: 1, leeway: .milliseconds(50))
    statusTimer.setEventHandler { [weak self] in
      guard let self = self, self.isRecording else { return }
      self.notifyStatus()
    }
    statusTimer.resume()
    self.statusTimer = statusTimer
  }

  private func stopTimers () {
    drainTimer?.cancel()
    drainTimer = nil
    statusTimer?.cancel()
    statusTimer = nil
  }

  private func notifyStatus () {
    statusHandler?(status)
  }

  deinit {
    stopTimers()
  }
}
