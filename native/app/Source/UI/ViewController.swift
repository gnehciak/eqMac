//
//  ViewController.swift
//  eqMac
//
//  Created by Roman Kisil on 10/12/2017.
//  Copyright © 2017 Roman Kisil. All rights reserved.
//

import Cocoa
import WebKit
import EmitterKit
import Shared

class ViewController: NSViewController, WKNavigationDelegate {
  // MARK: - Properties
  @IBOutlet var parentView: View!
  // Fork: the WKWebView is built in code (see setupWebView), NOT in the
  // storyboard. A WKWebView archived by a newer Xcode's Interface Builder can't
  // be decoded by an older macOS's WebKit — it throws an uncaught NSException in
  // -[WKWebView initWithCoder:] during NIB loading, aborting the app on launch
  // (e.g. an app built with the macOS 27 SDK crashing on macOS 15). Creating it
  // programmatically is version-independent and is Apple's recommended approach.
  var webView: WKWebView!
  @IBOutlet var draggableView: DraggableView!
  @IBOutlet var loadingView: NSView!
  @IBOutlet var loadingSpinner: NSProgressIndicator!
  let loaded = Event<Void>()

  var height: Double {
    get {
      return Double(webView.frame.size.height)
    }
    set {
      let newHeight = CGFloat(newValue)
      let newSize = NSSize(width: webView.frame.size.width, height: newHeight)
      self.view.setFrameSize(newSize)
    }
  }
  
  var width: Double {
    get {
      return Double(webView.frame.size.width)
    }
    set {
      let newWidth = CGFloat(newValue)
      let newSize = NSSize(width: newWidth, height: CGFloat(height))
      self.view.setFrameSize(newSize)
    }
  }

  // MARK: - Initialization
  override func viewDidLoad () {
    super.viewDidLoad()
    setupWebView()
    loadingSpinner.startAnimation(nil)
    loaded.emit()
  }

  // Builds the WKWebView in code and inserts it into the view hierarchy in the
  // exact position the storyboard used: above the loading view, below the
  // draggable title strip. Runs in viewDidLoad, before anything (window sizing,
  // UI.load, bridge.attach) touches `webView`. See the note on the property.
  private func setupWebView () {
    let configuration = WKWebViewConfiguration()
    configuration.mediaTypesRequiringUserActionForPlayback = []
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false

    let webView = WKWebView(frame: parentView.bounds, configuration: configuration)
    webView.wantsLayer = true
    webView.allowsLinkPreview = false
    webView.autoresizingMask = [ .width, .height ]

    self.webView = webView
    parentView.addSubview(webView, positioned: .below, relativeTo: draggableView)
  }

  func load (_ url: URL) {
    let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
    if self.webView.isLoading {
      self.webView.stopLoading()
    }
    self.webView.load(request)

    
    Async.delay(1000) {
      self.loadingView.isHidden = true
      self.loadingSpinner.stopAnimation(nil)
    }

    if Constants.DEBUG {
      Console.log("Enabling DevTools")
      self.webView.configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")
    }
  }
  
  // MARK: - Listeners
  override func viewWillAppear() {
    super.viewWillAppear()
  }
  
  func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    let cred = URLCredential(trust: challenge.protectionSpace.serverTrust!)
    completionHandler(.useCredential, cred)
  }
  
}

class View: NSView {
  override var acceptsFirstResponder: Bool { true }
  override func keyDown(with event: NSEvent) {
    // This is an override to disable OS sound effects (beeps and boops) when pressing keys inside the view
  }
  
}
