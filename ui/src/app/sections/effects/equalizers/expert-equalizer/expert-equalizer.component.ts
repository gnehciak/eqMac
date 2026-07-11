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
import {
  ExpertEqualizerService,
  ExpertEqualizerPreset,
  ExpertEqualizerBand,
  ExpertEqualizerPresetsChangedEventCallback,
  ExpertEqualizerSelectedPresetChangedEventCallback
} from 'src/app/sections/effects/equalizers/expert-equalizer/expert-equalizer.service'
import { EqualizerComponent } from '../equalizer.component'
import { Options, CheckboxOption } from 'src/app/components/options/options.component'
import { ApplicationService } from '../../../../services/app.service'
import { ToastService } from '../../../../services/toast.service'

@Component({
  selector: 'eqm-expert-equalizer',
  templateUrl: './expert-equalizer.component.html',
  styleUrls: [ './expert-equalizer.component.scss' ]
})
export class ExpertEqualizerComponent extends EqualizerComponent implements OnInit, OnDestroy {
  @Input() enabled = true

  @HostBinding('style.height.px') height = 280

  /** Native validates against this as well — keep in sync with the band schema */
  readonly maxBands = 64

  public ShowDefaultPresetsCheckbox: CheckboxOption = {
    type: 'checkbox',
    label: 'Show Default Presets',
    value: false,
    toggled: (show) => this.service.setShowDefaultPresets(show)
  }

  settings: Options = [ [
    {
      type: 'button',
      label: 'Import Presets',
      action: async () => {
        const log = await this.service.importPresets()
        this.toast.show({
          type: 'success',
          message: log
        })
      }
    }, {
      type: 'button',
      label: 'Export Presets',
      action: async () => {
        const log = await this.service.exportPresets()
        this.toast.show({
          type: 'success',
          message: log
        })
      }
    }
  ], [
    this.ShowDefaultPresetsCheckbox
  ] ]

  public _presets: ExpertEqualizerPreset[]
  @Output() presetsChange = new EventEmitter<ExpertEqualizerPreset[]>()
  set presets (newPresets: ExpertEqualizerPreset[]) {
    this._presets =
    [
      newPresets.find(p => p.id === 'manual'),
      newPresets.find(p => p.id === 'flat'),
      ...newPresets.filter(p => ![ 'manual', 'flat' ].includes(p.id)).sort((a, b) => a.name > b.name ? 1 : -1)
    ]
    this.presetsChange.emit(this.presets)
  }

  get presets () { return this._presets }

  public _selectedPreset: ExpertEqualizerPreset
  @Output() selectedPresetChange = new EventEmitter<ExpertEqualizerPreset>()
  set selectedPreset (newSelectedPreset: ExpertEqualizerPreset) {
    this._selectedPreset = newSelectedPreset
    this.selectedPresetChange.emit(this.selectedPreset)
  }

  get selectedPreset () { return this._selectedPreset }

  /**
   * Working copy of the selected preset's bands — the eq-graph mutates these
   * objects in place while dragging, gestures then copy them into the
   * 'manual' preset before POSTing (house special-preset contract).
   */
  bands: ExpertEqualizerBand[] = []
  globalGain = 0
  selectedBandId: string | null = null

  get selectedBand (): ExpertEqualizerBand | null {
    return this.bands.find(band => band.id === this.selectedBandId) || null
  }

  get canAddBand () {
    return this.bands.length < this.maxBands
  }

  constructor (
    public service: ExpertEqualizerService,
    public change: ChangeDetectorRef,
    public app: ApplicationService,
    public toast: ToastService
  ) {
    super()
  }

  async ngOnInit () {
    await this.sync()
    this.setupEvents()
    try {
      await this.service.enableSpectrum()
    } catch (err) {
      // Spectrum streaming is non-critical — the editor works without it
    }
  }

  async sync () {
    await Promise.all([
      this.syncSettings(),
      this.syncPresets()
    ])
  }

  public async syncPresets () {
    const [ presets, selectedPreset ] = await Promise.all([
      this.service.getPresets(),
      this.service.getSelectedPreset()
    ])
    this.presets = presets
    this.selectedPreset = presets.find(preset => preset.id === selectedPreset.id)
    this.setBandsFromSelectedPreset()
    this.change.detectChanges()
  }

  public async syncSettings () {
    return Promise.all([
      this.syncShowDefaultPresets()
    ])
  }

  public async syncShowDefaultPresets () {
    this.ShowDefaultPresetsCheckbox.value = await this.service.getShowDefaultPresets()
  }

  private setBandsFromSelectedPreset () {
    const preset = this.selectedPreset
    this.bands = ((preset && preset.bands) || []).map(band => ({ ...band }))
    this.globalGain = (preset && typeof preset.globalGain === 'number') ? preset.globalGain : 0
    if (this.selectedBandId && !this.bands.some(band => band.id === this.selectedBandId)) {
      this.selectedBandId = null
    }
  }

  private onPresetsChangedEventCallback: ExpertEqualizerPresetsChangedEventCallback
  private onSelectedPresetChangedEventCallback: ExpertEqualizerSelectedPresetChangedEventCallback
  protected setupEvents () {
    this.onPresetsChangedEventCallback = presets => {
      if (!presets) return
      this.presets = presets
      this.change.detectChanges()
    }
    this.service.onPresetsChanged(this.onPresetsChangedEventCallback)

    this.onSelectedPresetChangedEventCallback = preset => {
      if (this.ignoreUpdates) return
      this.selectedPreset = preset
      this.setBandsFromSelectedPreset()
      this.change.detectChanges()
    }
    this.service.onSelectedPresetChanged(this.onSelectedPresetChangedEventCallback)
  }

  private destroyEvents () {
    this.service.offPresetsChanged(this.onPresetsChangedEventCallback)
    this.service.offSelectedPresetChanged(this.onSelectedPresetChangedEventCallback)
  }

  // MARK: - Graph / Inspector gestures

  onBandChanged (band: ExpertEqualizerBand) {
    // eqm-eq-graph already mutated the band object in place and re-rendered
    this.applyBandsToManualPreset()
  }

  onInspectorBandChanged (band: ExpertEqualizerBand) {
    // New array reference so the eq-graph Input setter re-renders the curves
    this.bands = [ ...this.bands ]
    this.applyBandsToManualPreset()
  }

  onBandAdded (band: ExpertEqualizerBand) {
    if (!this.canAddBand) return
    this.bands = [ ...this.bands, band ]
    this.selectedBandId = band.id
    this.applyBandsToManualPreset()
  }

  onBandRemoved (band: ExpertEqualizerBand) {
    this.bands = this.bands.filter(b => b.id !== band.id)
    if (this.selectedBandId === band.id) {
      this.selectedBandId = null
    }
    this.applyBandsToManualPreset()
  }

  onBandSelected (band: ExpertEqualizerBand | null) {
    this.selectedBandId = band ? band.id : null
    this.change.detectChanges()
  }

  addBand () {
    if (!this.canAddBand) return
    const band: ExpertEqualizerBand = {
      id: `band-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'peak',
      frequency: 1000,
      gain: 0,
      q: 1.41,
      channel: 'both',
      enabled: true
    }
    this.onBandAdded(band)
  }

  /**
   * House special-preset contract: any gesture copies the current bands into
   * the 'manual' preset and POSTs it with select: true.
   */
  private applyBandsToManualPreset () {
    const manualPreset = this.getPreset('manual')
    if (!manualPreset) return
    manualPreset.bands = this.bands.map(band => ({ ...band }))
    manualPreset.globalGain = this.globalGain
    if (!this.selectedPreset || this.selectedPreset.id !== manualPreset.id) {
      this.selectedPreset = manualPreset
    }
    this.change.detectChanges()
    this.queueManualPresetSave()
  }

  // Band-drag streams are throttled to ~30Hz before POSTing to native
  private readonly saveIntervalMs = 1000 / 30
  private lastSaveTime = 0
  private pendingSaveTimer: any = null
  private queueManualPresetSave () {
    const elapsed = Date.now() - this.lastSaveTime
    if (elapsed >= this.saveIntervalMs) {
      this.lastSaveTime = Date.now()
      this.saveManualPreset()
    } else if (!this.pendingSaveTimer) {
      // Trailing save so the final gesture value always lands on native
      this.pendingSaveTimer = setTimeout(() => {
        this.pendingSaveTimer = null
        this.lastSaveTime = Date.now()
        this.saveManualPreset()
      }, this.saveIntervalMs - elapsed)
    }
  }

  public ignoreUpdates = false
  public ignoreUpdatesDebouncer: any = null
  private saveManualPreset () {
    const manualPreset = this.getPreset('manual')
    if (!manualPreset) return
    // Suppress our own event echoes while gesturing, then re-sync to converge
    this.ignoreUpdates = true
    if (this.ignoreUpdatesDebouncer) clearTimeout(this.ignoreUpdatesDebouncer)
    this.ignoreUpdatesDebouncer = setTimeout(() => {
      this.ignoreUpdatesDebouncer = null
      this.ignoreUpdates = false
      this.syncPresets()
    }, 1000)
    this.service.updatePreset(manualPreset, { select: true })
  }

  // MARK: - Preset contract (EqualizerComponent)

  getPreset (id: string) {
    return this.presets ? this.presets.find(p => p && p.id === id) : undefined
  }

  selectFlatPreset () {
    return this.selectPreset(this.getPreset('flat'))
  }

  async selectPreset (preset: ExpertEqualizerPreset) {
    this.selectedPreset = preset
    this.setBandsFromSelectedPreset()
    this.change.detectChanges()
    await this.service.selectPreset(preset)
  }

  async savePreset (name: string) {
    const bands = this.bands.map(band => ({ ...band }))
    const globalGain = this.globalGain
    const existingUserPreset = this.presets.filter(p => p && !p.isDefault).find(p => p.name === name)
    if (existingUserPreset) {
      // Overwrite
      await this.service.updatePreset({ id: existingUserPreset.id, name, bands, globalGain }, {
        select: true
      })
      this.selectedPreset = existingUserPreset
    } else {
      // Create
      this.selectedPreset = await this.service.createPreset({ name, bands, globalGain }, true)
    }
    await this.syncPresets()
  }

  async deletePreset () {
    if (!this.selectedPreset.isDefault) {
      await this.service.deletePreset(this.selectedPreset)
      this.selectFlatPreset()
    }
  }

  ngOnDestroy () {
    if (this.pendingSaveTimer) {
      // Flush the trailing gesture save so the final value persists
      clearTimeout(this.pendingSaveTimer)
      this.pendingSaveTimer = null
      this.saveManualPreset()
    }
    if (this.ignoreUpdatesDebouncer) {
      clearTimeout(this.ignoreUpdatesDebouncer)
      this.ignoreUpdatesDebouncer = null
    }
    this.destroyEvents()
    // Let the native FFT idle while the Expert EQ is not visible
    this.service.disableSpectrum().catch(() => {})
  }
}
