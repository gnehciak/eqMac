import { Injectable } from '@angular/core'
import { EffectService } from '../effect.service'

// Must match the Preamp gain range in
// native/app/Source/Audio/Effects/Preamp/Preamp.swift
export const PREAMP_GAIN_MIN = -24
export const PREAMP_GAIN_MAX = 24

@Injectable({
  providedIn: 'root'
})
export class PreampService extends EffectService {
  route = `${this.route}/preamp`

  async getGain (): Promise<number> {
    const resp = await this.request({ method: 'GET', endpoint: '/gain' })
    return resp.gain
  }

  setGain (gain: number) {
    return this.request({ method: 'POST', endpoint: '/gain', data: { gain } })
  }

  onGainChanged (callback: PreampGainChangedEventCallback) {
    this.on('/gain', callback)
  }

  offGainChanged (callback: PreampGainChangedEventCallback) {
    this.off('/gain', callback)
  }

  async getAutoGain (): Promise<boolean> {
    const resp = await this.request({ method: 'GET', endpoint: '/auto-gain' })
    // House naming maps the kebab-case route onto a camelCase key
    // (like /always-on-top -> { alwaysOnTop }), but tolerate { enabled } too.
    return typeof resp.autoGain === 'boolean' ? resp.autoGain : !!resp.enabled
  }

  setAutoGain (autoGain: boolean) {
    return this.request({ method: 'POST', endpoint: '/auto-gain', data: { autoGain } })
  }

  onAutoGainChanged (callback: PreampAutoGainChangedEventCallback) {
    this.on('/auto-gain', callback)
  }

  offAutoGainChanged (callback: PreampAutoGainChangedEventCallback) {
    this.off('/auto-gain', callback)
  }
}

export type PreampGainChangedEventCallback = (data: { gain: number }) => void
export type PreampAutoGainChangedEventCallback = (data: { autoGain?: boolean, enabled?: boolean }) => void
