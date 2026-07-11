import { Injectable } from '@angular/core'
import { EqualizersService } from '../equalizers.service'
import { EqualizerPreset } from '../presets/equalizer-presets.component'

export interface Graphic31EqualizerPreset extends EqualizerPreset {
  gains: {
    bands: number[]
    global: number
  }
}

@Injectable({
  providedIn: 'root'
})
export class Graphic31EqualizerService extends EqualizersService {
  route = `${this.route}/graphic31`

  getPresets () {
    return this.request({ method: 'GET', endpoint: '/presets' })
  }

  getSelectedPreset () {
    return this.request({ method: 'GET', endpoint: '/presets/selected' })
  }

  createPreset (preset: Graphic31EqualizerPreset, select: boolean = false) {
    return this.request({ method: 'POST', endpoint: '/presets', data: { ...preset, select } })
  }

  updatePreset (preset: Graphic31EqualizerPreset, opts?: { select?: boolean, transition?: boolean }) {
    return this.request({
      method: 'POST',
      endpoint: '/presets',
      data: {
        ...preset,
        select: opts?.select,
        transition: opts?.transition
      }
    })
  }

  selectPreset (preset: Graphic31EqualizerPreset) {
    return this.request({ method: 'POST', endpoint: '/presets/select', data: { ...preset } })
  }

  deletePreset (preset: Graphic31EqualizerPreset) {
    return this.request({ method: 'DELETE', endpoint: '/presets', data: { ...preset } })
  }

  importPresets () {
    return this.request({ method: 'GET', endpoint: '/presets/import' })
  }

  exportPresets () {
    return this.request({ method: 'GET', endpoint: '/presets/export' })
  }

  async getShowDefaultPresets () {
    const { show } = await this.request({ method: 'GET', endpoint: '/settings/show-default-presets' })
    return show
  }

  setShowDefaultPresets (show: boolean) {
    return this.request({ method: 'POST', endpoint: '/settings/show-default-presets', data: { show } })
  }

  onPresetsChanged (callback: Graphic31EqualizerPresetsChangedEventCallback) {
    this.on('/presets', callback)
  }

  offPresetsChanged (callback: Graphic31EqualizerPresetsChangedEventCallback) {
    this.off('/presets', callback)
  }

  onSelectedPresetChanged (callback: Graphic31EqualizerSelectedPresetChangedEventCallback) {
    this.on('/presets/selected', callback)
  }

  offSelectedPresetChanged (callback: Graphic31EqualizerSelectedPresetChangedEventCallback) {
    this.off('/presets/selected', callback)
  }
}

export type Graphic31EqualizerPresetsChangedEventCallback = (presets: Graphic31EqualizerPreset[]) => void
export type Graphic31EqualizerSelectedPresetChangedEventCallback = (preset: Graphic31EqualizerPreset) => void
