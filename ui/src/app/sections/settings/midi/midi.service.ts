import { Injectable } from '@angular/core'
import { DataService } from '../../../services/data.service'

export type MIDISourceKind = 'cc' | 'note'

export type MIDIMappingTarget =
  'volume' |
  'balance' |
  'preampGain' |
  'presetNext' |
  'presetPrevious' |
  'muteToggle' |
  'enabledToggle'

export interface MIDIMappingSource {
  /** 0-15, or -1 for "any channel" */
  channel: number
  kind: MIDISourceKind
  /** Controller / note number 0-127 */
  number: number
}

export interface MIDIMapping {
  id: string
  source: MIDIMappingSource
  target: MIDIMappingTarget
}

export interface MIDIDevice {
  id?: number
  name: string
  online: boolean
}

export type MIDIMappingsChangedEventCallback = (mappings: MIDIMapping[]) => void
export type MIDIDevicesChangedEventCallback = (devices: MIDIDevice[]) => void

@Injectable({
  providedIn: 'root'
})
export class MIDIService extends DataService {
  route = `${this.route}/midi`

  async getDevices (): Promise<MIDIDevice[]> {
    const devices = await this.request({ method: 'GET', endpoint: '/devices' })
    return Array.isArray(devices) ? devices : []
  }

  async getMappings (): Promise<MIDIMapping[]> {
    const mappings = await this.request({ method: 'GET', endpoint: '/mappings' })
    return Array.isArray(mappings) ? mappings : []
  }

  async setMappingTarget ({ id, target }: { id: string, target: MIDIMappingTarget }): Promise<MIDIMapping> {
    return this.request({
      method: 'POST',
      endpoint: '/mappings',
      data: { id, target }
    })
  }

  async deleteMapping ({ id }: { id: string }) {
    return this.request({
      method: 'DELETE',
      endpoint: '/mappings',
      data: { id }
    })
  }

  /**
   * Arms MIDI Learn for a target. The returned promise stays pending until
   * the next CC / Note On message binds (resolves with the new mapping) or
   * learn times out / gets cancelled (rejects).
   */
  async learn ({ target }: { target: MIDIMappingTarget }): Promise<MIDIMapping> {
    return this.request({
      method: 'POST',
      endpoint: '/learn',
      data: { target }
    })
  }

  async cancelLearn () {
    return this.request({ method: 'DELETE', endpoint: '/learn' })
  }

  async getEnabled (): Promise<boolean> {
    const resp = await this.request({ method: 'GET', endpoint: '/enabled' })
    return !!(resp && resp.enabled)
  }

  async setEnabled (enabled: boolean) {
    return this.request({
      method: 'POST',
      endpoint: '/enabled',
      data: { enabled }
    })
  }

  onMappingsChanged (callback: MIDIMappingsChangedEventCallback) {
    this.on('/mappings', callback)
  }

  offMappingsChanged (callback: MIDIMappingsChangedEventCallback) {
    this.off('/mappings', callback)
  }

  onDevicesChanged (callback: MIDIDevicesChangedEventCallback) {
    this.on('/devices', callback)
  }

  offDevicesChanged (callback: MIDIDevicesChangedEventCallback) {
    this.off('/devices', callback)
  }
}
