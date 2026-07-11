import { Injectable } from '@angular/core'
import { EffectService } from '../effect.service'

// Must match the RoutingMode enum raw values in
// native/app/Source/Audio/Effects/Routing/RoutingState.swift
export const RoutingModes = [
  'stereo',
  'monoDownmix',
  'swap',
  'leftToBoth',
  'rightToBoth'
] as const
export type RoutingMode = typeof RoutingModes[number]

@Injectable({
  providedIn: 'root'
})
export class RoutingService extends EffectService {
  route = `${this.route}/routing`

  async getMode (): Promise<RoutingMode> {
    const resp = await this.request({ method: 'GET', endpoint: '/mode' })
    return resp.mode
  }

  setMode (mode: RoutingMode) {
    return this.request({ method: 'POST', endpoint: '/mode', data: { mode } })
  }

  onModeChanged (callback: RoutingModeChangedEventCallback) {
    this.on('/mode', callback)
  }

  offModeChanged (callback: RoutingModeChangedEventCallback) {
    this.off('/mode', callback)
  }
}

export type RoutingModeChangedEventCallback = (data: { mode: RoutingMode }) => void
