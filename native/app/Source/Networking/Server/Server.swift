//
//  Server.swift
//  eqMac
//
//  Second transport for the DataBus tree.
//  Translates "METHOD /path" REST requests into HandlerRegistry dispatch on
//  the main queue and returns the same { data } / { error } envelope the
//  WebView bridge uses. Also owns the WebSocket API transport and the
//  static UI file server for LAN remote control.
//
//  Integration: call Server.start() from Application startup (after the
//  DataBus tree has been constructed / Bridge registrations exist) and
//  Server.setRemoteAccess(_:) from the Settings "Enable remote access" toggle.
//

import Foundation
import SwiftyJSON

#if canImport(Telegraph)
import Telegraph

class Server {
  // MARK: - Static API
  static var shared: Server?

  static var isRunning: Bool {
    return shared != nil
  }

  static var remoteAccessEnabled: Bool {
    return shared?.remoteAccess ?? false
  }

  static var httpPort: UInt {
    return shared?.httpApiPort ?? 0
  }

  static var socketPort: UInt {
    return shared?.webSocketTransport.port ?? 0
  }

  static var uiPort: UInt {
    return shared?.staticFileServer.port ?? 0
  }

  // Addresses remote devices can reach this machine on
  static var lanAddresses: [String] {
    return Networking.getLANAddresses()
  }

  // remoteAccess = false -> servers only bind the loopback interface
  // remoteAccess = true  -> servers bind all interfaces (LAN access,
  //                         protected by APIAuth bearer tokens)
  static func start (remoteAccess: Bool = false) {
    stop()
    shared = Server(remoteAccess: remoteAccess)
  }

  static func stop () {
    shared?.stopAll()
    shared = nil
  }

  static func setRemoteAccess (_ enabled: Bool) {
    if let shared = shared, shared.remoteAccess == enabled {
      return
    }
    start(remoteAccess: enabled)
  }

  // MARK: - Instance
  let remoteAccess: Bool
  let api = APIHTTPServer()
  let webSocketTransport = WebSocketTransport()
  let staticFileServer = StaticFileServer()
  private(set) var httpApiPort: UInt = 0

  init (remoteAccess: Bool) {
    self.remoteAccess = remoteAccess
    let interface: String? = remoteAccess ? nil : "localhost"
    startAPI(interface: interface)
    webSocketTransport.start(interface: interface)
    staticFileServer.start(interface: interface)
  }

  private func startAPI (interface: String?) {
    httpApiPort = Networking.getAvailabilePort(Constants.HTTP_SERVER_PREFERRED_PORT)
    api.httpConfig = HTTPConfig(requestHandlers: [
      APICORSHandler(),
      APIAuthHTTPHandler(),
      APIRequestHandler()
    ])
    api.concurrency = 8
    do {
      try api.start(port: Int(httpApiPort), interface: interface)
      Console.log("eqMac HTTP API server listening on port \(httpApiPort)")
    } catch {
      Console.log("Failed to start eqMac HTTP API server: \(error)")
    }
  }

  func stopAll () {
    api.stop(immediately: true)
    webSocketTransport.stop()
    staticFileServer.stop()
  }

  // MARK: - Helpers
  static func jsonResponse (status: HTTPStatus, body: JSON) -> HTTPResponse {
    let data = (try? body.rawData()) ?? Data()
    let response = HTTPResponse(status, body: data)
    response.headers.contentType = "application/json"
    return response
  }
}

// Stamps the TCP remote host onto every request so the auth layer can
// exempt loopback clients. The header is always overwritten, so remote
// clients cannot spoof it.
class APIHTTPServer: Telegraph.Server {
  override func handleIncoming (request: HTTPRequest, connection: HTTPConnection, error: Error?) {
    request.headers[APIAuth.REMOTE_HOST_HEADER] = connection.remoteEndpoint?.host ?? "unknown"
    super.handleIncoming(request: request, connection: connection, error: error)
  }
}

class APICORSHandler: HTTPRequestHandler {
  func respond (to request: HTTPRequest, nextHandler: HTTPRequest.Handler) throws -> HTTPResponse? {
    let response: HTTPResponse?
    if (request.method == .OPTIONS) {
      response = HTTPResponse(.noContent)
    } else {
      response = try nextHandler(request)
    }
    if let response = response {
      response.headers.accessControlAllowOrigin = "*"
      response.headers.accessControlAllowHeaders = "Authorization, Content-Type"
      response.headers.accessControlAllowMethods = "GET, POST, DELETE, OPTIONS"
    }
    return response
  }
}

// Bearer token middleware.
// Localhost requests are exempt by default, LAN requires a token
// obtained through pairing (POST /pair).
class APIAuthHTTPHandler: HTTPRequestHandler {
  func respond (to request: HTTPRequest, nextHandler: HTTPRequest.Handler) throws -> HTTPResponse? {
    let remoteHost = request.headers[APIAuth.REMOTE_HOST_HEADER] ?? "unknown"

    if Networking.isLoopback(address: remoteHost) {
      return try nextHandler(request)
    }

    // Pairing is how LAN clients obtain a token in the first place
    if (request.uri.path == APIAuth.PAIR_PATH) {
      return try nextHandler(request)
    }

    if let token = APIAuth.extractBearerToken(request.headers.authorization),
      APIAuth.shared.validate(token: token) {
      return try nextHandler(request)
    }

    return Server.jsonResponse(
      status: .unauthorized,
      body: APIEnvelope.failure(
        "Unauthorized. Pair with eqMac first (POST /pair) and send an \"Authorization: Bearer <token>\" header."
      )
    )
  }
}

// Translates REST requests into "METHOD /path" HandlerRegistry events
class APIRequestHandler: HTTPRequestHandler {
  static let SUPPORTED_METHODS: [HTTPMethod] = [ .GET, .POST, .DELETE ]

  func respond (to request: HTTPRequest, nextHandler: HTTPRequest.Handler) throws -> HTTPResponse? {
    guard APIRequestHandler.SUPPORTED_METHODS.contains(request.method) else {
      return Server.jsonResponse(
        status: .methodNotAllowed,
        body: APIEnvelope.failure("Method not supported: \(request.method.name)")
      )
    }

    let path = request.uri.path
    let remoteHost = request.headers[APIAuth.REMOTE_HOST_HEADER] ?? "unknown"

    if (request.method == .POST && path == APIAuth.PAIR_PATH) {
      return pair(request: request, remoteHost: remoteHost)
    }

    let event = "\(request.method.name) \(path)"
    let payload = APIRequestHandler.payload(from: request)

    // Block this Telegraph worker thread until the handler
    // (dispatched on the main queue) responds or times out
    var error: String?
    var data: JSON?
    let semaphore = DispatchSemaphore(value: 0)
    HandlerRegistry.shared.dispatch(event: event, data: payload) { dispatchError, dispatchData in
      error = dispatchError
      data = dispatchData
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + HandlerRegistry.dispatchTimeout + 5)

    if let error = error {
      let status: HTTPStatus = error.hasPrefix("Unknown endpoint") ? .notFound : .badRequest
      return Server.jsonResponse(status: status, body: APIEnvelope.failure(error))
    }
    return Server.jsonResponse(status: .ok, body: APIEnvelope.success(data))
  }

  private func pair (request: HTTPRequest, remoteHost: String) -> HTTPResponse {
    let body = try? JSON(data: request.body)
    let name = body?["name"].string ?? remoteHost

    var token: String?
    let semaphore = DispatchSemaphore(value: 0)
    APIAuth.shared.requestPairing(name: name, host: remoteHost) { newToken in
      token = newToken
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + APIAuth.PAIRING_TIMEOUT)

    if let token = token {
      return Server.jsonResponse(
        status: .ok,
        body: APIEnvelope.success(JSON([ "token": token ]))
      )
    }
    return Server.jsonResponse(
      status: .unauthorized,
      body: APIEnvelope.failure("Pairing request was denied")
    )
  }

  static func payload (from request: HTTPRequest) -> JSON? {
    if (!request.body.isEmpty) {
      if let json = try? JSON(data: request.body), json.type != .null {
        return json
      }
    }
    if let queryItems = request.uri.queryItems, queryItems.count > 0 {
      var dict: [String: Any] = [:]
      for item in queryItems {
        dict[item.name] = parse(queryValue: item.value)
      }
      return JSON(dict)
    }
    return nil
  }

  static func parse (queryValue: String?) -> Any {
    guard let value = queryValue else { return NSNull() }
    if let bool = Bool(value) { return bool }
    if let int = Int(value) { return int }
    if let double = Double(value) { return double }
    return value
  }
}

#else

// Telegraph pod is not installed - keep the same public surface
// so the rest of the app still compiles
class Server {
  static var shared: Server?
  static var isRunning: Bool { return false }
  static var remoteAccessEnabled: Bool { return false }
  static var httpPort: UInt { return 0 }
  static var socketPort: UInt { return 0 }
  static var uiPort: UInt { return 0 }
  static var lanAddresses: [String] { return Networking.getLANAddresses() }
  static func start (remoteAccess: Bool = false) {
    Console.log("eqMac API Server is unavailable - Telegraph pod is not installed")
  }
  static func stop () {}
  static func setRemoteAccess (_ enabled: Bool) {}
}

#endif
