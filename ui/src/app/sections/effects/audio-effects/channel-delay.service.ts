import { Injectable } from '@angular/core'
import { EffectService } from '../effect.service'

export interface ChannelDelaySettings {
  leftMs: number
  rightMs: number
}

// Must match ChannelDelayKernelParams.delayMsRange in
// native/app/Source/Audio/Effects/ChannelDelay/ChannelDelayKernel.swift
export const CHANNEL_DELAY_MS_MIN = 0
export const CHANNEL_DELAY_MS_MAX = 30

@Injectable({
  providedIn: 'root'
})
export class ChannelDelayService extends EffectService {
  route = `${this.route}/delay`

  async getSettings (): Promise<ChannelDelaySettings> {
    const resp = await this.request({ method: 'GET', endpoint: '/settings' })
    return {
      leftMs: resp.leftMs,
      rightMs: resp.rightMs
    }
  }

  setSettings (settings: { leftMs?: number, rightMs?: number }) {
    return this.request({ method: 'POST', endpoint: '/settings', data: settings })
  }

  onSettingsChanged (callback: ChannelDelaySettingsChangedEventCallback) {
    this.on('/settings', callback)
  }

  offSettingsChanged (callback: ChannelDelaySettingsChangedEventCallback) {
    this.off('/settings', callback)
  }
}

export type ChannelDelaySettingsChangedEventCallback = (data: ChannelDelaySettings) => void
