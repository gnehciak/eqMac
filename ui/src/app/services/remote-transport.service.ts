import { JSONData } from './data.service'

/**
 * WebSocket client for eqMac's native WebSocket API transport.
 * Used when the UI is NOT running inside the native WKWebView
 * (e.g. opened in a LAN browser from the static UI file server).
 *
 * Implements the same call / on / off surface as the Bridge:
 *   Requests:    { id, method, path, body } -> { id, data } or { id, error }
 *   Push events: { event: path, data }
 *
 * Auth handshake: localhost connections are exempt. LAN connections
 * authenticate with a bearer token stored in localStorage, obtained either
 * by pairing (native confirmation alert on the Mac) or manual entry.
 */

export interface RemoteResponseChannel {
  send: (data?: JSONData) => void
  error: (err: string | Error) => void
}

export type RemoteEventHandler = (data: any, res: RemoteResponseChannel) => void | Promise<void>

interface PendingRequest {
  resolve: (data?: any) => void
  reject: (err: Error) => void
  timer: any
}

export class RemoteTransport {
  public static readonly TOKEN_STORAGE_KEY = 'eqmac-remote-token'
  public static readonly SERVER_INFO_PATH = 'eqmac-server-info.json'

  public static socketPort = 37629
  public static connectTimeout = 5000
  public static requestTimeout = 15000
  // Pairing waits for the user to accept a native alert on the Mac
  public static pairTimeout = 90000

  private static socket: WebSocket = null
  private static connectPromise: Promise<void> = null
  private static requestId = 0
  private static readonly pending = new Map<number, PendingRequest>()
  private static readonly handlers: {
    [event: string]: RemoteEventHandler[]
  } = {}

  private static shouldReconnect = false
  private static reconnectAttempts = 0

  static get connected () {
    return !!RemoteTransport.socket && RemoteTransport.socket.readyState === WebSocket.OPEN
  }

  static async connect (): Promise<void> {
    if (RemoteTransport.connectPromise) {
      return RemoteTransport.connectPromise
    }
    RemoteTransport.connectPromise = RemoteTransport.establishConnectionWithRetries()
    try {
      await RemoteTransport.connectPromise
      RemoteTransport.shouldReconnect = true
      RemoteTransport.reconnectAttempts = 0
    } catch (err) {
      RemoteTransport.connectPromise = null
      throw err
    }
  }

  // Page load races the native app's server startup (and macOS may pause
  // background tabs) - retry the initial connection instead of failing every
  // caller that arrived during the race.
  private static async establishConnectionWithRetries (attempts = 4, delayMs = 1000): Promise<void> {
    let lastError: any
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await RemoteTransport.establishConnection()
      } catch (err) {
        lastError = err
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
    throw lastError
  }

  static async call (handler: string, data?: JSONData): Promise<any> {
    await RemoteTransport.connect()
    // Bridge event names look like "METHOD /path"
    const spaceIndex = handler.indexOf(' ')
    const method = spaceIndex > -1 ? handler.slice(0, spaceIndex) : 'GET'
    const path = spaceIndex > -1 ? handler.slice(spaceIndex + 1) : handler
    return RemoteTransport.sendFrame(method, path, data)
  }

  static async on (event: string, handler: RemoteEventHandler) {
    if (!(event in RemoteTransport.handlers)) {
      RemoteTransport.handlers[event] = []
    }
    RemoteTransport.handlers[event].push(handler)
  }

  static async off (event: string, handler: RemoteEventHandler) {
    const handlers = RemoteTransport.handlers[event]
    if (!handlers || !handlers.length) {
      console.error(`Trying to unsubscribe from event: "${event}" when there are no handlers registered`)
      return
    }
    const index = handlers.indexOf(handler)
    if (index > -1) {
      handlers.splice(index, 1)
    } else {
      console.error(`Trying to unsubscribe from event: "${event}" with a handler that is not registered`)
    }
  }

  // Connection

  private static async establishConnection () {
    await RemoteTransport.discoverPorts()
    await RemoteTransport.openSocket()
    await RemoteTransport.authenticate()
  }

  private static async discoverPorts () {
    try {
      if (!window.location.protocol.startsWith('http')) return
      const resp = await fetch(`${window.location.origin}/${RemoteTransport.SERVER_INFO_PATH}`)
      const info = await resp.json()
      if (info && typeof info.socketPort === 'number' && info.socketPort > 0) {
        RemoteTransport.socketPort = info.socketPort
      }
    } catch (err) {
      // Static UI server info not reachable, use the default port
    }
  }

  private static openSocket (): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const hostname = window.location.hostname || 'localhost'
      const url = `ws://${hostname}:${RemoteTransport.socketPort}`
      let settled = false
      const socket = new WebSocket(url)

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        socket.close()
        reject(new Error(`Could not connect to eqMac WebSocket API at ${url}`))
      }, RemoteTransport.connectTimeout)

      socket.onopen = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        RemoteTransport.socket = socket
        resolve()
      }
      socket.onerror = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`Could not connect to eqMac WebSocket API at ${url}`))
      }
      socket.onmessage = message => RemoteTransport.onMessage(message)
      socket.onclose = () => {
        clearTimeout(timer)
        RemoteTransport.onClose()
      }
    })
  }

  private static async authenticate () {
    // Localhost clients are exempt server side, so an AUTH frame with the
    // stored (possibly empty) token succeeds immediately for them
    const storedToken = localStorage.getItem(RemoteTransport.TOKEN_STORAGE_KEY) || ''
    try {
      await RemoteTransport.sendFrame('AUTH', '/auth', { token: storedToken })
      return
    } catch (err) {
      // No token stored or it is no longer valid, try to pair
    }

    try {
      const { token } = await RemoteTransport.sendFrame('PAIR', '/pair', {
        name: RemoteTransport.deviceName
      }, RemoteTransport.pairTimeout)
      if (token) {
        localStorage.setItem(RemoteTransport.TOKEN_STORAGE_KEY, token)
        return
      }
    } catch (err) {
      // Pairing was denied or timed out, fall back to manual token entry
    }

    const manualToken = window.prompt('Enter the eqMac remote access token')
    if (manualToken) {
      await RemoteTransport.sendFrame('AUTH', '/auth', { token: manualToken })
      localStorage.setItem(RemoteTransport.TOKEN_STORAGE_KEY, manualToken)
      return
    }

    throw new Error('eqMac remote access was not authorized')
  }

  static get deviceName () {
    return `Browser (${window.navigator.platform || 'Unknown device'})`
  }

  // Framing

  private static sendFrame (
    method: string,
    path: string,
    body?: JSONData,
    timeout: number = RemoteTransport.requestTimeout
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!RemoteTransport.connected) {
        return reject(new Error('eqMac WebSocket API is not connected'))
      }
      const id = ++RemoteTransport.requestId
      const timer = setTimeout(() => {
        RemoteTransport.pending.delete(id)
        reject(new Error(`Request timed out: ${method} ${path}`))
      }, timeout)
      RemoteTransport.pending.set(id, { resolve, reject, timer })
      RemoteTransport.socket.send(JSON.stringify({ id, method, path, body }))
    })
  }

  private static onMessage (message: MessageEvent) {
    let frame: any
    try {
      frame = JSON.parse(message.data)
    } catch (err) {
      return
    }
    if (!frame) return

    // Response to a request
    if (typeof frame.id !== 'undefined') {
      const request = RemoteTransport.pending.get(frame.id)
      if (!request) return
      RemoteTransport.pending.delete(frame.id)
      clearTimeout(request.timer)
      if (frame.error) {
        request.reject(new Error(frame.error))
      } else {
        request.resolve(frame.data)
      }
      return
    }

    // Push event
    if (typeof frame.event === 'string') {
      const handlers = RemoteTransport.handlers[frame.event] || []
      const res: RemoteResponseChannel = {
        // Push events over WebSocket are fire and forget
        send: () => {},
        error: err => console.error(err)
      }
      for (const handler of handlers) {
        Promise.resolve()
          .then(() => handler(frame.data, res))
          .catch(err => console.error(err))
      }
    }
  }

  private static onClose () {
    RemoteTransport.socket = null
    RemoteTransport.connectPromise = null
    const pending = Array.from(RemoteTransport.pending.values())
    RemoteTransport.pending.clear()
    for (const request of pending) {
      clearTimeout(request.timer)
      request.reject(new Error('eqMac WebSocket API connection was closed'))
    }
    RemoteTransport.scheduleReconnect()
  }

  private static scheduleReconnect () {
    if (!RemoteTransport.shouldReconnect) return
    const delay = Math.min(30000, 1000 * Math.pow(2, RemoteTransport.reconnectAttempts))
    RemoteTransport.reconnectAttempts += 1
    setTimeout(async () => {
      try {
        await RemoteTransport.connect()
      } catch (err) {
        RemoteTransport.scheduleReconnect()
      }
    }, delay)
  }
}
