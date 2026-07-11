//
//  StaticFileServer.swift
//  eqMac
//
//  Serves the unzipped local Angular UI build (UI.localPath) over HTTP on
//  Constants.UI_SERVER_PREFERRED_PORT so LAN browsers can remote control
//  eqMac (the served UI talks to the WebSocket API transport).
//

import Foundation
import SwiftyJSON

#if canImport(Telegraph)
import Telegraph

class StaticFileServer {
  // Port discovery endpoint for remote clients
  static let INFO_PATH = "eqmac-server-info.json"

  private let server = Telegraph.Server()
  private(set) var port: UInt = 0

  func start (interface: String?) {
    port = Networking.getAvailabilePort(Constants.UI_SERVER_PREFERRED_PORT)

    // Make sure the UI build has been unarchived
    // (UI.load() might not have run yet at app startup)
    let fs = FileManager.default
    if !fs.fileExists(atPath: UI.localPath.appendingPathComponent("index.html").path) {
      UI.unarchiveZip()
    }

    // Registered before the static file route so it takes priority
    server.route(.GET, StaticFileServer.INFO_PATH) { (_: HTTPRequest) -> HTTPResponse? in
      let info = JSON([
        "version": Application.version,
        "httpPort": Server.httpPort,
        "socketPort": Server.socketPort,
        "uiPort": Server.uiPort
      ])
      let response = HTTPResponse(.ok, body: (try? info.rawData()) ?? Data())
      response.headers.contentType = "application/json"
      response.headers.accessControlAllowOrigin = "*"
      return response
    }

    server.serveDirectory(UI.localPath, "/")

    do {
      try server.start(port: Int(port), interface: interface)
      Console.log("eqMac UI static file server listening on port \(port)")
    } catch {
      Console.log("Failed to start eqMac UI static file server: \(error)")
    }
  }

  func stop () {
    server.stop(immediately: true)
  }
}

#else

// Telegraph pod is not installed - stub keeps the app compiling
class StaticFileServer {
  private(set) var port: UInt = 0
  func start (interface: String?) {}
  func stop () {}
}

#endif
