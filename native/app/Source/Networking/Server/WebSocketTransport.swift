//
//  WebSocketTransport.swift
//  eqMac
//
//  WebSocket API transport on Constants.SOCKET_SERVER_PREFERRED_PORT.
//  Request frames:  { id, method, path, body } -> HandlerRegistry dispatch
//  Response frames: { id, data } or { id, error }
//  Push events (DataBus.send) are forwarded as: { event: path, data }
//
//  Auth: localhost connections are exempt. LAN connections must send either
//    { id, method: "AUTH", path: "/auth", body: { token } }  or
//    { id, method: "PAIR", path: "/pair", body: { name } }
//  before any other frame is accepted.
//

import Foundation
import SwiftyJSON

#if canImport(Telegraph)
import Telegraph

class WebSocketTransport {
  private let server = Telegraph.Server()
  private(set) var port: UInt = 0

  private class Client {
    weak var socket: WebSocket?
    var authenticated: Bool
    var host: String
    init (socket: WebSocket, authenticated: Bool, host: String) {
      self.socket = socket
      self.authenticated = authenticated
      self.host = host
    }
  }

  private let clientsQueue = DispatchQueue(label: "eqMac.WebSocketTransport.clients")
  private var clients: [ObjectIdentifier: Client] = [:]

  func start (interface: String?) {
    port = Networking.getAvailabilePort(Constants.SOCKET_SERVER_PREFERRED_PORT)
    server.webSocketDelegate = self
    do {
      try server.start(port: Int(port), interface: interface)
      HandlerRegistry.shared.add(sink: self)
      Console.log("eqMac WebSocket API server listening on port \(port)")
    } catch {
      Console.log("Failed to start eqMac WebSocket API server: \(error)")
    }
  }

  func stop () {
    HandlerRegistry.shared.remove(sink: self)
    server.stop(immediately: true)
  }

  // MARK: - Clients
  private func getClient (_ webSocket: WebSocket) -> Client? {
    return clientsQueue.sync { clients[ObjectIdentifier(webSocket)] }
  }

  private func setAuthenticated (_ webSocket: WebSocket) {
    clientsQueue.sync {
      clients[ObjectIdentifier(webSocket)]?.authenticated = true
    }
  }

  // MARK: - Sending
  private func send (frame: JSON, to socket: WebSocket) {
    guard let text = frame.rawString(String.Encoding.utf8, options: []) else { return }
    socket.send(text: text)
  }

  private func broadcast (frame: JSON) {
    let sockets: [WebSocket] = clientsQueue.sync {
      clients.values.compactMap { client in
        if (!client.authenticated) { return nil }
        return client.socket
      }
    }
    for socket in sockets {
      send(frame: frame, to: socket)
    }
  }

  // MARK: - Frame handling
  private func handle (text: String, from webSocket: WebSocket) {
    let frame = JSON(parseJSON: text)
    guard frame.type == .dictionary else { return }

    let id = frame["id"]
    let method = (frame["method"].string ?? "").uppercased()
    let path = frame["path"].string ?? ""
    let body: JSON? = frame["body"].exists() ? frame["body"] : nil

    func reply (_ payload: JSON) {
      var payload = payload
      if id.exists() {
        payload["id"] = id
      }
      self.send(frame: payload, to: webSocket)
    }

    switch method {
    case "AUTH":
      if (getClient(webSocket)?.authenticated == true) {
        return reply(APIEnvelope.success(JSON([ "authenticated": true ])))
      }
      let token = body?["token"].string ?? ""
      if APIAuth.shared.validate(token: token) {
        setAuthenticated(webSocket)
        return reply(APIEnvelope.success(JSON([ "authenticated": true ])))
      }
      return reply(APIEnvelope.failure("Invalid token"))

    case "PAIR":
      let host = getClient(webSocket)?.host ?? "unknown"
      let name = body?["name"].string ?? host
      APIAuth.shared.requestPairing(name: name, host: host) { token in
        if let token = token {
          self.setAuthenticated(webSocket)
          reply(APIEnvelope.success(JSON([ "token": token ])))
        } else {
          reply(APIEnvelope.failure("Pairing request was denied"))
        }
      }
      return

    default:
      guard getClient(webSocket)?.authenticated == true else {
        return reply(APIEnvelope.failure("Unauthorized. Send a PAIR or AUTH frame first."))
      }
      guard method != "" && path != "" else {
        return reply(APIEnvelope.failure("Invalid frame: method and path are required"))
      }
      let event = "\(method) \(path)"
      HandlerRegistry.shared.dispatch(event: event, data: body) { error, data in
        if let error = error {
          return reply(APIEnvelope.failure(error))
        }
        reply(APIEnvelope.success(data))
      }
    }
  }
}

// MARK: - PushSink
extension WebSocketTransport: PushSink {
  func push (event: String, data: JSON?) {
    var frame = JSON([ "event": event ])
    if let data = data {
      frame["data"] = data
    }
    broadcast(frame: frame)
  }
}

// MARK: - ServerWebSocketDelegate
extension WebSocketTransport: ServerWebSocketDelegate {
  func server (_ server: Telegraph.Server, webSocketDidConnect webSocket: WebSocket, handshake: HTTPRequest) {
    let host = webSocket.remoteEndpoint?.host ?? "unknown"
    // Localhost connections are exempt from token auth by default
    let authenticated = Networking.isLoopback(address: host)
    clientsQueue.sync {
      clients[ObjectIdentifier(webSocket)] = Client(
        socket: webSocket,
        authenticated: authenticated,
        host: host
      )
    }
  }

  func server (_ server: Telegraph.Server, webSocketDidDisconnect webSocket: WebSocket, error: Error?) {
    _ = clientsQueue.sync {
      clients.removeValue(forKey: ObjectIdentifier(webSocket))
    }
  }

  func server (_ server: Telegraph.Server, webSocket: WebSocket, didReceiveMessage message: WebSocketMessage) {
    guard case .text(let text) = message.payload else { return }
    handle(text: text, from: webSocket)
  }
}

#else

// Telegraph pod is not installed - stub keeps the app compiling
class WebSocketTransport {
  private(set) var port: UInt = 0
  func start (interface: String?) {}
  func stop () {}
}

#endif
