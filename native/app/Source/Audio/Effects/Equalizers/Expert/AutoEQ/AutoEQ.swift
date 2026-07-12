//
//  AutoEQ.swift
//  eqMac
//
//  AutoEQ headphone preset database (jaakkopasanen/AutoEq).
//
//  The database ships as a bundled, gzipped JSON resource
//  (Assets/Embedded/autoeq-db.json.gz, ~8850 entries). It is loaded,
//  gunzipped and decoded lazily on a background utility queue the first
//  time any request needs it, then cached in memory for the rest of the
//  app's lifetime.
//
//  Decompression choice: the Compression framework's COMPRESSION_ZLIB codec
//  is *raw* DEFLATE (RFC 1951) - it understands neither the >=10 byte gzip
//  header nor the 8 byte CRC32/ISIZE trailer (RFC 1952 framing), so a tiny
//  gzip header parser strips the framing before decoding. (Foundation's
//  NSData.decompressed(using: .zlib) has the same raw-DEFLATE semantics and
//  is macOS 10.15+ only, so the header parser is the simplest
//  dependency-free option for the 10.12 deployment target.)
//
//  Database JSON schema (version 1):
//  {
//    version: 1, count: Int,
//    entries: [{
//      n: name, s: source, r: rig, p: preampDb,
//      b: [{ t: 'peak'|'lowShelf'|'highShelf', f: freqHz, g: gainDb, q }]
//    }]
//  }
//

import Foundation
import Compression

struct AutoEQBand: Codable {
  /// BiquadFilterType raw value: peak | lowShelf | highShelf
  let t: String
  /// Center / corner frequency in Hz
  let f: Double
  /// Gain in dB
  let g: Double
  /// Quality factor
  let q: Double
}

struct AutoEQEntry: Codable {
  /// Headphone name
  let n: String
  /// Measurement source (database)
  let s: String
  /// Measurement rig / form factor
  let r: String
  /// Preamp in dB (maps to the Expert Equalizer preset globalGain)
  let p: Double
  /// Correction filter bands
  let b: [AutoEQBand]
}

struct AutoEQDatabase: Codable {
  let version: Int
  let count: Int
  let entries: [AutoEQEntry]
}

struct AutoEQSearchResult {
  /// Index of the entry inside the loaded database, stringified.
  /// Stable for the lifetime of the bundled database (one per app version).
  let id: String
  let name: String
  let source: String
  let rig: String

  var dictionary: [String: String] {
    return [
      "id": id,
      "name": name,
      "source": source,
      "rig": rig
    ]
  }
}

/// An AutoEQ entry mapped onto the Expert Equalizer preset schema
struct AutoEQPreset {
  let name: String
  let source: String
  let rig: String
  let bands: [ExpertEqualizerPresetBand]
  let globalGain: Double
}

class AutoEQ {
  /// Search responses are capped to this many rows
  static let SEARCH_LIMIT = 200

  // MARK: - Lazy cached database

  private static var loadAttempted = false
  private static var entries: [AutoEQEntry]?
  /// Parallel array of lowercased names so repeated searches don't re-fold
  /// 8850 strings per keystroke
  private static var searchKeys: [String] = []

  /// All loading and searching happens on this serial utility queue -
  /// completions are delivered on the main queue.
  private static let queue = DispatchQueue(
    label: "com.bitgapp.eqmac.autoeq",
    qos: .utility
  )

  /// Runs work on the utility queue with the (lazily loaded) database.
  /// The database is parsed at most once per app lifetime - a missing or
  /// corrupt resource caches the failure instead of re-parsing forever.
  private static func perform (_ work: @escaping (_ entries: [AutoEQEntry]?, _ searchKeys: [String]) -> Void) {
    queue.async {
      if (!loadAttempted) {
        loadAttempted = true
        if let loaded = loadDatabase() {
          entries = loaded
          searchKeys = loaded.map { $0.n.lowercased() }
        }
      }
      work(entries, searchKeys)
    }
  }

  /// Warms the cache (first call gunzips + decodes on the utility queue).
  /// Completion is delivered on the main queue with the availability flag.
  static func load (_ completion: @escaping (Bool) -> Void) {
    perform { entries, _ in
      let available = entries != nil
      DispatchQueue.main.async {
        completion(available)
      }
    }
  }

  /// Case-insensitive substring search over the headphone name.
  /// An empty query matches every entry. Results are capped at `limit`,
  /// `total` is the uncapped match count. `results` is nil only when the
  /// database itself could not be loaded.
  /// Completion is delivered on the main queue.
  static func search (
    query: String,
    limit: Int = AutoEQ.SEARCH_LIMIT,
    _ completion: @escaping (_ results: [AutoEQSearchResult]?, _ total: Int) -> Void
  ) {
    perform { entries, searchKeys in
      guard let entries = entries else {
        DispatchQueue.main.async { completion(nil, 0) }
        return
      }
      let needle = query
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
      var results: [AutoEQSearchResult] = []
      var total = 0
      for (index, key) in searchKeys.enumerated() {
        if (needle.isEmpty || key.contains(needle)) {
          total += 1
          if (results.count < limit) {
            let entry = entries[index]
            results.append(AutoEQSearchResult(
              id: String(index),
              name: entry.n,
              source: entry.s,
              rig: entry.r
            ))
          }
        }
      }
      DispatchQueue.main.async {
        completion(results, total)
      }
    }
  }

  /// Resolves a search result id to an Expert Equalizer shaped preset.
  /// Completion is delivered on the main queue (nil = unknown id or
  /// unavailable database).
  static func get (id: String, _ completion: @escaping (AutoEQPreset?) -> Void) {
    perform { entries, _ in
      guard let entries = entries,
            let index = Int(id),
            entries.indices.contains(index) else {
        DispatchQueue.main.async { completion(nil) }
        return
      }
      let preset = self.preset(from: entries[index])
      DispatchQueue.main.async {
        completion(preset)
      }
    }
  }

  // MARK: - Mapping

  /// Maps an AutoEQ entry onto the Expert Equalizer preset band schema.
  /// AutoEq data can exceed the Expert Equalizer's validated ranges, so
  /// every parameter is clamped defensively (frequency 20-20000, gain
  /// -24..24, q 0.1..10, globalGain -24..24). Bands with an unknown filter
  /// type are dropped (same policy as ExpertEqualizer.updateKernel).
  static func preset (from entry: AutoEQEntry) -> AutoEQPreset {
    let bands: [ExpertEqualizerPresetBand] = entry.b.compactMap { band in
      guard BiquadFilterType(rawValue: band.t) != nil else { return nil }
      return ExpertEqualizerPresetBand(
        id: UUID().uuidString,
        type: band.t,
        frequency: clamp(band.f, 20, 20_000),
        gain: clamp(band.g, -24, 24),
        q: clamp(band.q, 0.1, 10),
        channel: "both",
        enabled: true
      )
    }
    return AutoEQPreset(
      name: entry.n,
      source: entry.s,
      rig: entry.r,
      bands: bands,
      globalGain: clamp(entry.p, -24, 24)
    )
  }

  private static func clamp (_ value: Double, _ min: Double, _ max: Double) -> Double {
    return value < min ? min : (value > max ? max : value)
  }

  // MARK: - Database loading (utility queue)

  private static func loadDatabase () -> [AutoEQEntry]? {
    guard let url = databaseURL() else {
      Console.log("AutoEQ: bundled database resource not found")
      return nil
    }
    guard let gzipped = try? Data(contentsOf: url) else {
      Console.log("AutoEQ: could not read database resource")
      return nil
    }
    guard let json = gunzip(gzipped) else {
      Console.log("AutoEQ: could not decompress database resource")
      return nil
    }
    guard let database = try? JSONDecoder().decode(AutoEQDatabase.self, from: json) else {
      Console.log("AutoEQ: could not decode database JSON")
      return nil
    }
    Console.log("AutoEQ: loaded \(database.entries.count) entries (schema version \(database.version))")
    return database.entries
  }

  /// The Assets directory ships in the bundle as a folder reference, so the
  /// resource lives under a subdirectory. Several layouts are probed to stay
  /// robust against how the folder reference flattens into Resources.
  private static func databaseURL () -> URL? {
    let candidates = [
      Bundle.main.url(forResource: "autoeq-db", withExtension: "json.gz", subdirectory: "Embedded"),
      Bundle.main.url(forResource: "autoeq-db", withExtension: "json.gz", subdirectory: "Assets/Embedded"),
      Bundle.main.url(forResource: "autoeq-db", withExtension: "json.gz")
    ]
    for case let url? in candidates {
      return url
    }
    // Last resort: walk the Resources tree
    let fs = FileManager.default
    if let resourceURL = Bundle.main.resourceURL,
       let enumerator = fs.enumerator(at: resourceURL, includingPropertiesForKeys: nil) {
      for case let url as URL in enumerator where url.lastPathComponent == "autoeq-db.json.gz" {
        return url
      }
    }
    return nil
  }

  // MARK: - gzip

  /// Strips the RFC 1952 gzip framing (>=10 byte header, optional extra
  /// fields, 8 byte CRC32 + ISIZE trailer) and raw-DEFLATE decodes the
  /// payload with the Compression framework's COMPRESSION_ZLIB codec.
  /// The ISIZE trailer field sizes the output buffer exactly.
  static func gunzip (_ data: Data) -> Data? {
    // Fixed header: magic 0x1f 0x8b, compression method 8 (deflate),
    // flags, mtime (4), xfl, os
    guard data.count > 18,
          data[0] == 0x1f,
          data[1] == 0x8b,
          data[2] == 8 else {
      return nil
    }
    let flags = data[3]
    var offset = 10
    if (flags & 0x04 != 0) { // FEXTRA: 2 byte little-endian length + payload
      guard data.count > offset + 2 else { return nil }
      let xlen = Int(data[offset]) | (Int(data[offset + 1]) << 8)
      offset += 2 + xlen
    }
    if (flags & 0x08 != 0) { // FNAME: null-terminated string
      while offset < data.count && data[offset] != 0 { offset += 1 }
      offset += 1
    }
    if (flags & 0x10 != 0) { // FCOMMENT: null-terminated string
      while offset < data.count && data[offset] != 0 { offset += 1 }
      offset += 1
    }
    if (flags & 0x02 != 0) { // FHCRC: 2 byte header CRC
      offset += 2
    }

    // 8 byte trailer: CRC32 + ISIZE (uncompressed size mod 2^32)
    let trailerStart = data.count - 8
    guard trailerStart > offset else { return nil }
    let isize = Int(data[trailerStart + 4])
      | (Int(data[trailerStart + 5]) << 8)
      | (Int(data[trailerStart + 6]) << 16)
      | (Int(data[trailerStart + 7]) << 24)
    // Sanity cap - the bundled database inflates to ~5 MB
    guard isize > 0, isize <= 512 * 1024 * 1024 else { return nil }

    let deflated = data.subdata(in: offset ..< trailerStart)
    var inflated = Data(count: isize)
    let decoded = inflated.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) -> Int in
      return deflated.withUnsafeBytes { (src: UnsafeRawBufferPointer) -> Int in
        guard let dstPointer = dst.bindMemory(to: UInt8.self).baseAddress,
              let srcPointer = src.bindMemory(to: UInt8.self).baseAddress else {
          return 0
        }
        return compression_decode_buffer(
          dstPointer, isize,
          srcPointer, deflated.count,
          nil,
          COMPRESSION_ZLIB
        )
      }
    }
    guard decoded == isize else { return nil }
    return inflated
  }
}
