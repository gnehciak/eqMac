//
//  HandlerRegistry.swift
//  eqMac
//
//  Mirror of every Bridge.on() registration.
//  Lets alternative transports (HTTP + WebSocket API servers) dispatch the
//  exact same DataBus handlers the WebView uses, and lets DataBus push sends
//  (Bridge.call) fan out to non-WebView clients via the PushSink protocol.
//

import Foundation
import SwiftyJSON

// Receives DataBus push events (Bridge.call sends without a callback)
// so they can be forwarded to remote clients (e.g. WebSocket connections)
protocol PushSink: AnyObject {
  func push (event: String, data: JSON?)
}

typealias BridgeEventHandler = (_ data: JSON?, _ res: BridgeResponse) -> Void

class HandlerRegistry {
  static let shared = HandlerRegistry()

  static let dispatchTimeout: Double = 15

  private let accessQueue = DispatchQueue(label: "eqMac.HandlerRegistry.access")
  private var handlers: [String: BridgeEventHandler] = [:]
  private var sinks: [ObjectIdentifier: SinkBox] = [:]

  private class SinkBox {
    weak var sink: PushSink?
    init (_ sink: PushSink) {
      self.sink = sink
    }
  }

  var events: [String] {
    return accessQueue.sync { Array(handlers.keys) }
  }

  // MARK: - Handlers
  func register (event: String, handler: @escaping BridgeEventHandler) {
    accessQueue.sync {
      handlers[event] = handler
    }
  }

  func handler (for event: String) -> BridgeEventHandler? {
    return accessQueue.sync { handlers[event] }
  }

  // MARK: - Push sinks
  func add (sink: PushSink) {
    accessQueue.sync {
      sinks[ObjectIdentifier(sink)] = SinkBox(sink)
    }
  }

  func remove (sink: PushSink) {
    accessQueue.sync {
      _ = sinks.removeValue(forKey: ObjectIdentifier(sink))
    }
  }

  func push (event: String, data: JSON?) {
    let boxes = accessQueue.sync { Array(sinks.values) }
    for box in boxes {
      box.sink?.push(event: event, data: data)
    }
  }

  // MARK: - Dispatch
  // Dispatches the handler for an event on the main queue
  // (DataBus handlers assume main thread - they dispatch store actions).
  // Completion is invoked exactly once, on an arbitrary background queue.
  func dispatch (
    event: String,
    data: JSON?,
    timeout: Double = HandlerRegistry.dispatchTimeout,
    completion: @escaping (_ error: String?, _ data: JSON?) -> Void
  ) {
    guard let handler = handler(for: event) else {
      completion("Unknown endpoint: \(event)", nil)
      return
    }

    let completionQueue = DispatchQueue(label: "eqMac.HandlerRegistry.completion")
    var completed = false
    func complete (_ error: String?, _ resp: JSON?) {
      completionQueue.async {
        if (completed) { return }
        completed = true
        completion(error, resp)
      }
    }

    DispatchQueue.main.async {
      let res = BridgeResponse(
        send: { resp in complete(nil, resp) },
        error: { err in complete(err, nil) }
      )
      handler(data, res)
    }

    completionQueue.asyncAfter(deadline: .now() + timeout) {
      if (completed) { return }
      completed = true
      completion("Request timed out", nil)
    }
  }
}

// Envelope matching Bridge.swift's WebViewJavascriptBridge response
// serialization - only dictionary, array, string and nil payloads
// are supported, everything else serializes to null
struct APIEnvelope {
  static func serialize (_ resp: JSON?) -> Any {
    if (resp == nil || resp == JSON.null || resp!.type == SwiftyJSON.Type.unknown) {
      return NSNull()
    } else if let dict = resp!.dictionaryObject {
      return dict
    } else if let array = resp!.arrayObject {
      return array
    } else if let str = resp!.string {
      return str
    }
    return NSNull()
  }

  static func success (_ resp: JSON?) -> JSON {
    return JSON([ "data": serialize(resp) ])
  }

  static func failure (_ error: String) -> JSON {
    return JSON([ "error": error ])
  }
}
