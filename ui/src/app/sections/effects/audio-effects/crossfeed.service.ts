import { Injectable } from '@angular/core'
import { EffectService } from '../effect.service'

export interface CrossfeedSettings {
  cutoff: number
  level: number
}

// Must match CrossfeedKernelParams in
// native/app/Source/Audio/Effects/Crossfeed/CrossfeedKernel.swift
export const CROSSFEED_CUTOFF_MIN = 300
export const CROSSFEED_CUTOFF_MAX = 2000
export const CROSSFEED_CUTOFF_DEFAULT = 700
export const CROSSFEED_LEVEL_MIN = 1
export const CROSSFEED_LEVEL_MAX = 15
export const CROSSFEED_LEVEL_DEFAULT = 4.5

@Injectable({
  providedIn: 'root'
})
export class CrossfeedService extends EffectService {
  route = `${this.route}/crossfeed`

  async getSettings (): Promise<CrossfeedSettings> {
    const resp = await this.request({ method: 'GET', endpoint: '/settings' })
    return {
      cutoff: resp.cutoff,
      level: resp.level
    }
  }

  setSettings (settings: { cutoff?: number, level?: number }) {
    return this.request({ method: 'POST', endpoint: '/settings', data: settings })
  }

  onSettingsChanged (callback: CrossfeedSettingsChangedEventCallback) {
    this.on('/settings', callback)
  }

  offSettingsChanged (callback: CrossfeedSettingsChangedEventCallback) {
    this.off('/settings', callback)
  }
}

export type CrossfeedSettingsChangedEventCallback = (data: CrossfeedSettings) => void
