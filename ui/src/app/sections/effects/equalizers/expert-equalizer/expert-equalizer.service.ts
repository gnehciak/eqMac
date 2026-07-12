import { Injectable } from '@angular/core'
import { Subject } from 'rxjs'
import { EqualizersService } from '../equalizers.service'
import { EqualizerPreset } from '../presets/equalizer-presets.component'

export const ExpertEqualizerFilterTypes = [
  'peak',
  'lowPass',
  'highPass',
  'lowShelf',
  'highShelf',
  'bandPass',
  'notch',
  'allPass'
] as const
export type ExpertEqualizerFilterType = typeof ExpertEqualizerFilterTypes[number]

export const ExpertEqualizerBandChannels = [ 'left', 'right', 'both' ] as const
export type ExpertEqualizerBandChannel = typeof ExpertEqualizerBandChannels[number]

/**
 * Matches the native band schema exactly:
 * { id, type, frequency, gain, q, channel, enabled }
 *
 * Deliberately a type alias (not an interface) so it structurally satisfies
 * the JSONData request payload type and the eqm-eq-graph EqGraphBand shape.
 */
export type ExpertEqualizerBand = {
  id: string
  type: ExpertEqualizerFilterType
  frequency: number
  gain: number
  q: number
  channel: ExpertEqualizerBandChannel
  enabled: boolean
}

export interface ExpertEqualizerPreset extends EqualizerPreset {
  bands: ExpertEqualizerBand[]
  globalGain: number
}

@Injectable({
  providedIn: 'root'
})
export class ExpertEqualizerService extends EqualizersService {
  route = `${this.route}/expert`

  getPresets (): Promise<ExpertEqualizerPreset[]> {
    return this.request({ method: 'GET', endpoint: '/presets' })
  }

  getSelectedPreset (): Promise<ExpertEqualizerPreset> {
    return this.request({ method: 'GET', endpoint: '/presets/selected' })
  }

  createPreset (preset: Partial<ExpertEqualizerPreset>, select: boolean = false): Promise<ExpertEqualizerPreset> {
    return this.request({ method: 'POST', endpoint: '/presets', data: { ...preset, select } })
  }

  updatePreset (preset: Partial<ExpertEqualizerPreset>, opts?: { select?: boolean, transition?: boolean }) {
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

  selectPreset (preset: ExpertEqualizerPreset) {
    return this.request({ method: 'POST', endpoint: '/presets/select', data: { ...preset } })
  }

  deletePreset (preset: ExpertEqualizerPreset) {
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

  onPresetsChanged (callback: ExpertEqualizerPresetsChangedEventCallback) {
    this.on('/presets', callback)
  }

  offPresetsChanged (callback: ExpertEqualizerPresetsChangedEventCallback) {
    this.off('/presets', callback)
  }

  onSelectedPresetChanged (callback: ExpertEqualizerSelectedPresetChangedEventCallback) {
    this.on('/presets/selected', callback)
  }

  offSelectedPresetChanged (callback: ExpertEqualizerSelectedPresetChangedEventCallback) {
    this.off('/presets/selected', callback)
  }

  // MARK: - Spectrum

  /**
   * Live FFT magnitude frames (~64 log-spaced 20Hz-20kHz bins in dB) pushed
   * by the native SpectrumAnalyzer while spectrum streaming is enabled.
   * Feed straight into <eqm-spectrum [frames]="service.spectrum">.
   */
  public readonly spectrum = new Subject<number[]>()

  private readonly onSpectrumFrameEventCallback = (data: any) => {
    // Native SpectrumDataBus pushes { sampleRate, bins: [dBFS…] }. Accept a bare
    // array or a { magnitudes } shape too for forward-compatibility, but `bins`
    // is the actual field the running native build emits.
    const frame: number[] | null = Array.isArray(data)
      ? data
      : (data && Array.isArray(data.bins) ? data.bins
        : (data && Array.isArray(data.magnitudes) ? data.magnitudes : null))
    if (frame && frame.length) {
      this.spectrum.next(frame)
    }
  }

  private spectrumSubscribed = false

  setSpectrumEnabled (enabled: boolean) {
    return this.request({ method: 'POST', endpoint: '/spectrum/enabled', data: { enabled } })
  }

  /** Subscribes to spectrum pushes and asks native to start the FFT */
  async enableSpectrum () {
    if (!this.spectrumSubscribed) {
      this.spectrumSubscribed = true
      this.on('/spectrum', this.onSpectrumFrameEventCallback)
    }
    await this.setSpectrumEnabled(true)
  }

  /** Unsubscribes from spectrum pushes and lets the native FFT idle */
  async disableSpectrum () {
    if (this.spectrumSubscribed) {
      this.spectrumSubscribed = false
      this.off('/spectrum', this.onSpectrumFrameEventCallback)
    }
    await this.setSpectrumEnabled(false)
  }
}

export type ExpertEqualizerPresetsChangedEventCallback = (presets: ExpertEqualizerPreset[]) => void
export type ExpertEqualizerSelectedPresetChangedEventCallback = (preset: ExpertEqualizerPreset) => void
