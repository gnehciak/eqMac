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
import { Options, CheckboxOption, ButtonOption } from 'src/app/components/options/options.component'
import { ApplicationService } from '../../../../services/app.service'
import { ToastService } from '../../../../services/toast.service'
import { TranslateService } from '../../../../services/translate.service'
import { Subscription } from 'rxjs'
import { MatDialog } from '@angular/material/dialog'
import { AutoEQBrowserComponent } from './autoeq/autoeq-browser.component'
import { AdditionalPresetOption } from '../presets/equalizer-presets.component'
import { FlatSliderValueChangedEvent } from '@eqmac/components'
import {
  PreampService,
  PreampAutoGainChangedEventCallback
} from '../../audio-effects/preamp.service'

@Component({
  selector: 'eqm-expert-equalizer',
  templateUrl: './expert-equalizer.component.html',
  styleUrls: [ './expert-equalizer.component.scss' ]
})
export class ExpertEqualizerComponent extends EqualizerComponent implements OnInit, OnDestroy {
  @Input() enabled = true

  // Pro-style layout: graph, band strips, global gain row, add-band bar.
  // These constants both drive the template ([style.height.px]) and the
  // host height binding below, which feeds the native window sizing.
  readonly graphHeight = 260
  readonly stripsHeight = 176
  readonly globalRowHeight = 30
  readonly addBandBarHeight = 24
  readonly layoutGap = 6

  @HostBinding('style.height.px') get height () {
    return this.graphHeight +
      this.stripsHeight +
      this.globalRowHeight +
      this.addBandBarHeight +
      this.layoutGap * 3
  }

  /** Native validates against this as well — keep in sync with the band schema */
  readonly maxBands = 64

  /** Pro-style headphones button in the preset row — opens the AutoEQ browser */
  additionalPresetOptionRight: AdditionalPresetOption = {
    tooltip: '', // set by applyTranslations()
    icon: 'headphones',
    iconSize: 14,
    action: () => this.openAutoEQBrowser()
  }

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

  private readonly autoEQButton: ButtonOption = {
    type: 'button',
    label: '',  // set by applyTranslations()
    action: () => this.openAutoEQBrowser()
  }

  private openAutoEQBrowser () {
    if (this.settingsDialog) this.settingsDialog.close()
    this.dialog.open(AutoEQBrowserComponent, { hasBackdrop: true, disableClose: false })
  }

  settings: Options = [ [
    this.importPresetsButton,
    this.exportPresetsButton,
    this.autoEQButton
  ], [
    this.ShowDefaultPresetsCheckbox
  ] ]

  // Options arrays carry TS-built labels — retranslate them in place when
  // the user switches language (object identity is preserved)
  private applyTranslations () {
    this.ShowDefaultPresetsCheckbox.label = this.translate.instant('equalizers.showDefaultPresets')
    this.importPresetsButton.label = this.translate.instant('equalizers.importPresets')
    this.exportPresetsButton.label = this.translate.instant('equalizers.exportPresets')
    this.autoEQButton.label = this.translate.instant('autoeq.title')
    this.additionalPresetOptionRight.tooltip = this.translate.instant('autoeq.title')
  }

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

  /** Band inspector popover — opened via a strip's pencil button */
  inspectorVisible = false

  /** Preamp auto-gain state, surfaced as the 'Auto' checkbox in the Global row */
  autoGainOn = false

  get selectedBand (): ExpertEqualizerBand | null {
    return this.bands.find(band => band.id === this.selectedBandId) || null
  }

  get canAddBand () {
    return this.bands.length < this.maxBands
  }

  get globalGainScreenValue () {
    return `${this.globalGain > 0 ? '+' : ''}${this.globalGain.toFixed(1)}dB`
  }

  constructor (
    public service: ExpertEqualizerService,
    public change: ChangeDetectorRef,
    public app: ApplicationService,
    public toast: ToastService,
    private readonly translate: TranslateService,
    public dialog: MatDialog,
    public preamp: PreampService
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
      this.syncShowDefaultPresets(),
      this.syncAutoGain()
    ])
  }

  public async syncAutoGain () {
    try {
      this.autoGainOn = await this.preamp.getAutoGain()
    } catch (err) {
      // Auto-gain state is non-critical — the editor works without it
    }
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
      this.inspectorVisible = false
    }
  }

  private onPresetsChangedEventCallback: ExpertEqualizerPresetsChangedEventCallback
  private onSelectedPresetChangedEventCallback: ExpertEqualizerSelectedPresetChangedEventCallback
  private onAutoGainChangedEventCallback: PreampAutoGainChangedEventCallback
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

    this.onAutoGainChangedEventCallback = data => {
      this.autoGainOn = typeof data.autoGain === 'boolean' ? data.autoGain : !!data.enabled
      this.change.detectChanges()
    }
    this.preamp.onAutoGainChanged(this.onAutoGainChangedEventCallback)
  }

  private destroyEvents () {
    this.service.offPresetsChanged(this.onPresetsChangedEventCallback)
    this.service.offSelectedPresetChanged(this.onSelectedPresetChangedEventCallback)
    this.preamp.offAutoGainChanged(this.onAutoGainChangedEventCallback)
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
      this.inspectorVisible = false
    }
    this.applyBandsToManualPreset()
  }

  onBandSelected (band: ExpertEqualizerBand | null) {
    this.selectedBandId = band ? band.id : null
    if (!band) {
      this.inspectorVisible = false
    }
    this.change.detectChanges()
  }

  /** Strip pencil button — select the band and open the inspector popover */
  onBandEdit (band: ExpertEqualizerBand) {
    this.selectedBandId = band.id
    this.inspectorVisible = true
    this.change.detectChanges()
  }

  closeInspector () {
    this.inspectorVisible = false
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

  // MARK: - Global row (global gain + preamp auto-gain)

  setGlobalGain (event: FlatSliderValueChangedEvent) {
    this.globalGain = Math.round(event.value * 10) / 10
    this.applyBandsToManualPreset()
  }

  setAutoGain (on: boolean) {
    this.autoGainOn = on
    this.preamp.setAutoGain(on).catch(() => {})
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
    if (this.localeChangedSubscription) {
      this.localeChangedSubscription.unsubscribe()
    }
    this.destroyEvents()
    // Let the native FFT idle while the Expert EQ is not visible
    this.service.disableSpectrum().catch(() => {})
  }
}
