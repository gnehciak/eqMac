import { Injectable } from '@angular/core'
import { EffectService } from '../effect.service'
import { EqualizersComponent } from './equalizers.component'

// NOTE: these strings are protocol values passed to the native
// EqualizerType enum ('Graphic31' — no space — matches the raw value the
// on-disk SuperPresets/Hotkeys/MIDI native code dispatches with).
// Visible tab labels are translated separately (equalizers.* keys).
export const EqualizersTypes = [
  'Basic',
  'Advanced',
  'Expert',
  'Graphic31'
] as const
export type EqualizerType = typeof EqualizersTypes[number]

@Injectable({
  providedIn: 'root'
})
export class EqualizersService extends EffectService {
  route = `${this.route}/equalizers`

  ref?: EqualizersComponent

  async getType (): Promise<EqualizerType> {
    const resp = await this.request({ method: 'GET', endpoint: '/type' })
    return resp.type
  }

  setType (type: EqualizerType) {
    return this.request({ method: 'POST', endpoint: '/type', data: { type } })
  }

  onTypeChanged (callback: EqualizersTypeChangedEventCallback) {
    this.on('/type', callback)
  }

  offTypeChanged (callback: EqualizersTypeChangedEventCallback) {
    this.off('/type', callback)
  }
}

export type EqualizersTypeChangedEventCallback = (data: { type: EqualizerType }) => void
