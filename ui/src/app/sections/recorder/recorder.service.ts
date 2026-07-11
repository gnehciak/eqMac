import { Injectable } from '@angular/core'
import { DataService } from '../../services/data.service'

export interface RecorderStatus {
  recording: boolean
  seconds: number
  path?: string
}

export interface RecorderDestination {
  path: string
  isDefault: boolean
}

export type RecorderStatusChangedEventCallback = (status: RecorderStatus) => void

@Injectable({
  providedIn: 'root'
})
export class RecorderService extends DataService {
  route = `${this.route}/recorder`

  async getStatus (): Promise<RecorderStatus> {
    return this.request({ method: 'GET', endpoint: '/status' })
  }

  async start (): Promise<RecorderStatus> {
    return this.request({ method: 'POST', endpoint: '/start' })
  }

  async stop (): Promise<{ path?: string }> {
    return this.request({ method: 'POST', endpoint: '/stop' })
  }

  async getDestination (): Promise<RecorderDestination> {
    return this.request({ method: 'GET', endpoint: '/destination' })
  }

  /**
   * Opens the native folder selection panel. Resolves with the (possibly
   * unchanged, if the user cancelled) destination once the panel closes.
   */
  async selectDestination (): Promise<RecorderDestination> {
    return this.request({ method: 'POST', endpoint: '/destination' })
  }

  async resetDestination (): Promise<RecorderDestination> {
    return this.request({ method: 'DELETE', endpoint: '/destination' })
  }

  reveal (path: string) {
    return this.request({ method: 'POST', endpoint: '/reveal', data: { path } })
  }

  onStatusChanged (callback: RecorderStatusChangedEventCallback) {
    this.on('/status', callback)
  }

  offStatusChanged (callback: RecorderStatusChangedEventCallback) {
    this.off('/status', callback)
  }
}
