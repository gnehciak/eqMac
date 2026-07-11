import { JSONData } from './data.service'
import { RemoteTransport } from './remote-transport.service'

interface BridgeResponseData {
  error?: string
  data?: JSONData
}

interface BridgeResponse {
  send: (data?: JSONData) => void
  error: (err: string | Error) => void
}

type CallHandler = (handler: string, data: JSONData, cb: CallHandlerCallback) => void
type CallHandlerCallback = (data?: BridgeResponseData) => void

type RegisterHandler = (handler: string, cb: RegisterHandlerCallback) => void
type RegisterHandlerCallback = (data: JSONData, cb: (data?: BridgeResponseData) => void) => void

type EventHandler = (data: JSONData, res: BridgeResponse) => void | Promise<void>

interface JSBridge {
  callHandler: CallHandler
  registerHandler: RegisterHandler
  disableJavscriptAlertBoxSafetyTimeout: () => void
}

export type BridgeTransportType = 'native' | 'remote'

/**
 * Class Bridge class that connect JavaScript runtime to Swift if page is rendered in WKWebView<br>
 * Under the hood uses [WebViewJavascriptBridge](https://github.com/marcuswestin/WebViewJavascriptBridge)
 *
 * When WebViewJavascriptBridge is absent (UI running in a standalone browser,
 * e.g. LAN remote control) it falls back to the WebSocket based RemoteTransport
 * which implements the same call / on / off surface.
 */
export class Bridge {
  public static loadTimeout = 10000
  /**
   * When the UI is NOT served over the file:// protocol it might be running
   * in a standalone browser. In that case only wait a short amount of time
   * for WebViewJavascriptBridge before falling back to the remote transport.
   */
  public static remoteDetectTimeout = 2000
  public static loadPromise: Promise<JSBridge> = null
  public static transportType: BridgeTransportType = null
  private static transportPromise: Promise<BridgeTransportType> = null
  private static didSpeedUp = false
  private static readonly handlers: {
    [event: string]: EventHandler[]
  } = {}

  public static get bridge () {
    if (Bridge.loadPromise) {
      return Bridge.loadPromise
    }
    Bridge.loadPromise = new Promise(async (resolve) => {
      const bridgeKey = 'WebViewJavascriptBridge'
      if (window[bridgeKey]) {
        return resolve(window[bridgeKey])
      }

      const bridgeCallbacksKey = 'WVJBCallbacks'
      if (window[bridgeCallbacksKey]) {
        return window[bridgeCallbacksKey].push(resolve)
      }
      window[bridgeCallbacksKey] = [ resolve ]

      const WVJBIframe = document.createElement('iframe')
      WVJBIframe.style.display = 'none'
      WVJBIframe.src = 'https://__bridge_loaded__'
      document.documentElement.appendChild(WVJBIframe)
      setTimeout(() => document.documentElement.removeChild(WVJBIframe), 0)

      // Load timeouts are handled by waitForBridge() so that the
      // remote transport fallback can be attempted in between
    })

    return Bridge.loadPromise
  }

  private static waitForBridge (timeout: number): Promise<JSBridge> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Bridge loading timed out')), timeout)
      Bridge.bridge.then(bridge => {
        clearTimeout(timer)
        resolve(bridge)
      }, err => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  public static get transport (): Promise<BridgeTransportType> {
    if (Bridge.transportPromise) {
      return Bridge.transportPromise
    }
    Bridge.transportPromise = Bridge.detectTransport()
    return Bridge.transportPromise
  }

  private static async detectTransport (): Promise<BridgeTransportType> {
    const isNativeContext = window.location.protocol === 'file:'
    const detectTimeout = isNativeContext ? Bridge.loadTimeout : Bridge.remoteDetectTimeout
    try {
      await Bridge.waitForBridge(detectTimeout)
      Bridge.transportType = 'native'
    } catch (err) {
      // WebViewJavascriptBridge did not load - probably running in a
      // standalone browser. Fall back to the WebSocket remote transport.
      try {
        await RemoteTransport.connect()
        Bridge.transportType = 'remote'
      } catch (remoteErr) {
        // Remote transport unavailable - give the native bridge
        // the full load timeout as a last resort
        await Bridge.waitForBridge(Bridge.loadTimeout)
        Bridge.transportType = 'native'
      }
    }
    return Bridge.transportType
  }

  static async call (handler: string, data?: JSONData): Promise<any> {
    const transport = await Bridge.transport
    if (transport === 'remote') {
      return RemoteTransport.call(handler, data)
    }
    return new Promise(async (resolve, reject) => {
      const bridge = await this.bridge
      if (!Bridge.didSpeedUp) {
        Bridge.didSpeedUp = true
        bridge.disableJavscriptAlertBoxSafetyTimeout()
      }
      bridge.callHandler(handler, data, res => {
        const err = res.error
        return err ? reject(new Error(err)) : resolve(res.data)
      })
    })
  }

  static async on (event: string, handler: EventHandler) {
    const transport = await Bridge.transport
    if (transport === 'remote') {
      return RemoteTransport.on(event, handler)
    }
    const bridge = await this.bridge
    let shouldRegister = false
    if (!(event in Bridge.handlers)) {
      Bridge.handlers[event] = []
      shouldRegister = true
    }

    Bridge.handlers[event].push(handler)

    if (shouldRegister) {
      bridge.registerHandler(event, async (data, cb) => {
        const handleError = (err: string | Error) => {
          console.error(err)
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          cb({ error: err.toString() })
        }

        for (const handler of Bridge.handlers[event]) {
          try {
            await handler(data, {
              send: (data) => cb({ data }),
              error: (err) => handleError(err)
            })
          } catch (err) {
            handleError(err)
          }
        }
      })
    }
  }

  static async off (event: string, handler: EventHandler) {
    const transport = await Bridge.transport
    if (transport === 'remote') {
      return RemoteTransport.off(event, handler)
    }
    if (!Bridge.handlers[event]?.length) {
      console.error(`Trying to unsubscribe from event: "${event}" when there are no handlers registered`)
      return
    }
    const index = Bridge.handlers[event]?.indexOf(handler)
    if (index > -1) {
      Bridge.handlers[event].splice(index, 1)
    } else {
      console.error(`Trying to unsubscribe from event: "${event}" with a handler that is not registered`)
    }
  }
}
