import { Injectable } from '@angular/core'
import { EffectService } from '../effect.service'

export interface AvailableAudioUnit {
  name: string
  manufacturerName: string
  version?: string
  componentType: number
  componentSubType: number
  componentManufacturer: number
  hasCustomView?: boolean
}

export type AudioUnitStatus = 'loading' | 'ready' | 'failed'

export interface AudioUnitChainItem {
  id: string
  name: string
  manufacturerName?: string
  enabled: boolean
  hasCustomView?: boolean
  status: AudioUnitStatus
  componentType: number
  componentSubType: number
  componentManufacturer: number
}

export type AudioUnitsChainChangedEventCallback = (
  data?: AudioUnitChainItem[] | { units?: AudioUnitChainItem[] }
) => void

@Injectable({
  providedIn: 'root'
})
export class AudioUnitsService extends EffectService {
  route = `${this.route}/audio-units`

  /**
   * Native replies with a bare array — tolerate an { units: [...] } wrapper
   * as well. Returns null when the payload carries no list at all, so
   * callers can decide to re-fetch instead.
   */
  static parseList<T> (resp: any): T[] | null {
    if (Array.isArray(resp)) return resp
    if (resp && Array.isArray(resp.units)) return resp.units
    return null
  }

  async getAvailable (): Promise<AvailableAudioUnit[]> {
    const resp = await this.request({ method: 'GET', endpoint: '/available' })
    return AudioUnitsService.parseList<AvailableAudioUnit>(resp) || []
  }

  async getChain (): Promise<AudioUnitChainItem[]> {
    const resp = await this.request({ method: 'GET', endpoint: '/chain' })
    return AudioUnitsService.parseList<AudioUnitChainItem>(resp) || []
  }

  addToChain (unit: {
    componentType: number
    componentSubType: number
    componentManufacturer: number
  }) {
    return this.request({
      method: 'POST',
      endpoint: '/chain/add',
      data: {
        componentType: unit.componentType,
        componentSubType: unit.componentSubType,
        componentManufacturer: unit.componentManufacturer
      }
    })
  }

  removeFromChain (id: string) {
    return this.request({ method: 'POST', endpoint: '/chain/remove', data: { id } })
  }

  move (id: string, index: number) {
    return this.request({ method: 'POST', endpoint: '/chain/move', data: { id, index } })
  }

  setUnitEnabled (id: string, enabled: boolean) {
    return this.request({ method: 'POST', endpoint: '/chain/enabled', data: { id, enabled } })
  }

  openEditor (id: string) {
    return this.request({ method: 'POST', endpoint: '/editor/open', data: { id } })
  }

  onChainChanged (callback: AudioUnitsChainChangedEventCallback) {
    this.on('/chain', callback)
  }

  offChainChanged (callback: AudioUnitsChainChangedEventCallback) {
    this.off('/chain', callback)
  }
}
