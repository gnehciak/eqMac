import { Injectable } from '@angular/core'
import { DataService } from '../../services/data.service'

export interface MixerApp {
  bundleId: string
  name?: string
  pid?: number
  volume?: number
  muted?: boolean
}

export type AppsChangedEventCallback = (data?: MixerApp[] | { apps?: MixerApp[] }) => void

@Injectable({
  providedIn: 'root'
})
export class AppMixerService extends DataService {
  route = `${this.route}/app-mixer`

  /**
   * Native replies either with a bare array or with { apps: [...] }.
   * Returns null when the payload doesn't contain an app list at all,
   * so callers can decide to re-fetch instead.
   */
  static parseApps (resp: any): MixerApp[] | null {
    if (Array.isArray(resp)) return resp
    if (resp && Array.isArray(resp.apps)) return resp.apps
    return null
  }

  async getApps (): Promise<MixerApp[]> {
    const resp = await this.request({ method: 'GET', endpoint: '/apps' })
    return AppMixerService.parseApps(resp) || []
  }

  setVolume ({ bundleId, volume, muted }: { bundleId: string, volume: number, muted: boolean }) {
    return this.request({
      method: 'POST',
      endpoint: '/volume',
      data: { bundleId, volume, muted }
    })
  }

  onAppsChanged (callback: AppsChangedEventCallback) {
    this.on('/apps', callback)
  }

  offAppsChanged (callback: AppsChangedEventCallback) {
    this.off('/apps', callback)
  }
}
