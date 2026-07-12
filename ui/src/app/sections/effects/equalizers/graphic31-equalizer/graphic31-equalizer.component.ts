import {
  Component,
  OnInit,
  Input,
  EventEmitter,
  Output,
  ChangeDetectorRef,
  OnDestroy,
  HostBinding
} from '@angular/core'
import { Graphic31EqualizerService, Graphic31EqualizerPreset, Graphic31EqualizerPresetsChangedEventCallback, Graphic31EqualizerSelectedPresetChangedEventCallback } from 'src/app/sections/effects/equalizers/graphic31-equalizer/graphic31-equalizer.service'
import { EqualizerComponent } from '../equalizer.component'
import { Options, CheckboxOption, ButtonOption } from 'src/app/components/options/options.component'
import { TransitionService } from '../../../../services/transitions.service'
import { ApplicationService } from '../../../../services/app.service'
import { ToastService } from '../../../../services/toast.service'
import { UIService } from '../../../../services/ui.service'
import { TranslateService } from '../../../../services/translate.service'
import { ColorsService } from '@eqmac/components'
import { Subscription } from 'rxjs'

export const GRAPHIC31_WINDOW_WIDTH = 680

@Component({
  selector: 'eqm-graphic31-equalizer',
  templateUrl: './graphic31-equalizer.component.html',
  styleUrls: [ './graphic31-equalizer.component.scss' ]
})
export class Graphic31EqualizerComponent extends EqualizerComponent implements OnInit, OnDestroy {
  @Input() enabled = true

  @HostBinding('style.height.px') height = 240

  public ShowDefaultPresetsCheckbox: CheckboxOption = {
    type: 'checkbox',
    label: '',  // set by applyTranslations()
    value: false,
    toggled: (show) => this.service.setShowDefaultPresets(show)
  }

  private readonly importPresetsButton: ButtonOption = {
    type: 'button',
    label: '',  // set by applyTranslations()
    action: async () => {
      const log = await this.service.importPresets()
      this.toast.show({
        type: 'success',
        message: log
      })
    }
  }

  private readonly exportPresetsButton: ButtonOption = {
    type: 'button',
    label: '',  // set by applyTranslations()
    action: async () => {
      const log = await this.service.exportPresets()
      this.toast.show({
        type: 'success',
        message: log
      })
    }
  }

  settings: Options = [ [
    this.importPresetsButton,
    this.exportPresetsButton
  ], [
    this.ShowDefaultPresetsCheckbox
  ] ]

  // Options arrays carry TS-built labels — retranslate them in place when
  // the user switches language (object identity is preserved)
  private applyTranslations () {
    this.ShowDefaultPresetsCheckbox.label = this.translate.instant('equalizers.showDefaultPresets')
    this.importPresetsButton.label = this.translate.instant('equalizers.importPresets')
    this.exportPresetsButton.label = this.translate.instant('equalizers.exportPresets')
  }

  public _presets: Graphic31EqualizerPreset[]
  @Output() presetsChange = new EventEmitter<Graphic31EqualizerPreset[]>()
  set presets (newPresets: Graphic31EqualizerPreset[]) {
    this._presets =
    [
      newPresets.find(p => p.id === 'manual'),
      newPresets.find(p => p.id === 'flat'),
      ...newPresets.filter(p => ![ 'manual', 'flat' ].includes(p.id)).sort((a, b) => a.name > b.name ? 1 : -1)
    ]
    this.presetsChange.emit(this.presets)
  }

  get presets () { return this._presets }

  public _selectedPreset: Graphic31EqualizerPreset
  @Output() selectedPresetChange = new EventEmitter<Graphic31EqualizerPreset>()
  set selectedPreset (newSelectedPreset: Graphic31EqualizerPreset) {
    this._selectedPreset = newSelectedPreset
    this.selectedPresetChange.emit(this.selectedPreset)
  }

  get selectedPreset () { return this._selectedPreset }

  bandFrequencyLabels = [
    '20', '25', '31', '40', '50', '63', '80', '100', '125', '160',
    '200', '250', '315', '400', '500', '630', '800', '1k', '1.2k', '1.6k',
    '2k', '2.5k', '3.1k', '4k', '5k', '6.3k', '8k', '10k', '12k', '16k',
    '20k'
  ]

  bands = [ ...Array(31) ].map(() => 0)
  global = 0

  stickSlidersToMiddle = true
  setSelectedPresetsGains () {
    // TODO: Refactor this bollocks
    // Global
    const currentGlobalGain = this.global
    if (this.global !== this.selectedPreset.gains.global) {
      this.stickSlidersToMiddle = false
      this.change.detectChanges()
      this.transition.perform(currentGlobalGain, this.selectedPreset.gains.global, value => {
        this.global = value
        if (value === this.selectedPreset.gains.global) {
          this.stickSlidersToMiddle = true
        }
        this.change.detectChanges()
      })
    }
    for (const [ i, gain ] of this.selectedPreset.gains.bands.entries()) {
      const currentGain = this.bands[i]
      if (currentGain !== gain) {
        this.stickSlidersToMiddle = false
        this.change.detectChanges()
        this.transition.perform(currentGain, gain, value => {
          this.bands[i] = value
          if (value === gain) {
            this.stickSlidersToMiddle = true
          }
          this.change.detectChanges()
        })
      }
    }
  }

  constructor (
    public service: Graphic31EqualizerService,
    public transition: TransitionService,
    public change: ChangeDetectorRef,
    public app: ApplicationService,
    public toast: ToastService,
    public ui: UIService,
    public colors: ColorsService,
    private readonly translate: TranslateService
  ) {
    super()
    this.applyTranslations()
  }

  private localeChangedSubscription: Subscription

  async ngOnInit () {
    this.localeChangedSubscription = this.translate.localeChanged.subscribe(() => {
      this.applyTranslations()
      this.change.detectChanges()
    })
    this.applyWindowWidth()
    await this.sync()
    this.setupEvents()
  }

  async sync () {
    await Promise.all([
      this.syncSettings(),
      this.syncPresets()
    ])
  }

  // 31 columns do not fit into the default ~450px window,
  // so widen the window while this Equalizer is active and
  // restore the original width once it's deactivated (component destroyed).
  private previousWindowWidth?: number
  private appliedWindowWidth?: number
  private async applyWindowWidth () {
    try {
      const targetWidth = Math.round(GRAPHIC31_WINDOW_WIDTH * (this.ui.scale || 1))
      const currentWidth = await this.ui.getWidth()
      if (currentWidth < targetWidth) {
        this.previousWindowWidth = currentWidth
        this.appliedWindowWidth = targetWidth
        await this.ui.setWidth(targetWidth)
      }
    } catch (err) {}
  }

  private async restoreWindowWidth () {
    try {
      if (typeof this.previousWindowWidth !== 'number') return
      const currentWidth = await this.ui.getWidth()
      // Only restore if the user hasn't manually resized the window since
      if (typeof this.appliedWindowWidth === 'number' && Math.abs(currentWidth - this.appliedWindowWidth) <= 1) {
        await this.ui.setWidth(this.previousWindowWidth)
      }
      this.previousWindowWidth = undefined
      this.appliedWindowWidth = undefined
    } catch (err) {}
  }

  public async syncPresets () {
    const [ presets, selectedPreset ] = await Promise.all([
      this.service.getPresets(),
      this.service.getSelectedPreset()
    ])
    this.presets = presets
    this.selectedPreset = presets.find(preset => preset.id === selectedPreset.id)
    this.setSelectedPresetsGains()
  }

  public async syncSettings () {
    return Promise.all([
      this.syncShowDefaultPresets()
    ])
  }

  public async syncShowDefaultPresets () {
    this.ShowDefaultPresetsCheckbox.value = await this.service.getShowDefaultPresets()
  }

  private onPresetsChangedEventCallback: Graphic31EqualizerPresetsChangedEventCallback
  private onSelectedPresetChangedEventCallback: Graphic31EqualizerSelectedPresetChangedEventCallback
  protected setupEvents () {
    this.onPresetsChangedEventCallback = presets => {
      if (!presets) return
      this.presets = presets
    }
    this.service.onPresetsChanged(this.onPresetsChangedEventCallback)

    this.onSelectedPresetChangedEventCallback = preset => {
      this.selectedPreset = preset
      this.setSelectedPresetsGains()
    }
    this.service.onSelectedPresetChanged(this.onSelectedPresetChangedEventCallback)
  }

  private destroyEvents () {
    this.service.offPresetsChanged(this.onPresetsChangedEventCallback)
    this.service.offSelectedPresetChanged(this.onSelectedPresetChangedEventCallback)
  }

  async selectPreset (preset: Graphic31EqualizerPreset) {
    this.selectedPreset = preset
    this.setSelectedPresetsGains()
    await this.service.selectPreset(preset)
  }

  getPreset (id: string) {
    return this.presets.find(p => p.id === id)
  }

  selectFlatPreset () {
    return this.selectPreset(this.getPreset('flat'))
  }

  async setGain (index: number | 'global', event: { value: number, transition?: boolean }) {
    const manualPreset = this.presets.find(p => p.id === 'manual')
    if (this.selectedPreset.id !== manualPreset.id) {
      manualPreset.gains = {
        bands: [ ...this.selectedPreset.gains.bands ],
        global: this.selectedPreset.gains.global
      }
    }

    if (index === 'global') {
      manualPreset.gains.global = event.value
    } else {
      manualPreset.gains.bands[index] = event.value
    }
    this.selectedPreset = manualPreset

    if (!event.transition) {
      this.setSelectedPresetsGains()
    }

    this.change.detectChanges()
    this.service.updatePreset(manualPreset, {
      select: true,
      transition: event.transition
    })
  }

  async savePreset (name: string) {
    const { gains } = this.selectedPreset
    const existingUserPreset = this.presets.filter(p => !p.isDefault).find(p => p.name === name)
    if (existingUserPreset) {
      // Overwrite
      await this.service.updatePreset({ id: existingUserPreset.id, name, gains }, {
        select: true
      })
      this.selectedPreset = existingUserPreset
    } else {
      // Create
      this.selectedPreset = await this.service.createPreset({ name, gains }, true)
    }
    await this.syncPresets()
  }

  async deletePreset () {
    if (!this.selectedPreset.isDefault) {
      await this.service.deletePreset(this.selectedPreset)
      this.selectFlatPreset()
    }
  }

  screenValue (gain: number) {
    return `${gain > 0 ? '+' : ''}${(gain.toFixed(1))}dB`
  }

  bandScreenValue (gain: number) {
    return `${gain > 0 ? '+' : ''}${(gain.toFixed(1))}`
  }

  performHapticFeedback () {
    this.app.haptic()
  }

  bandTracker (index) {
    return index
  }

  ngOnDestroy () {
    if (this.localeChangedSubscription) {
      this.localeChangedSubscription.unsubscribe()
    }
    this.destroyEvents()
    this.restoreWindowWidth()
  }
}
