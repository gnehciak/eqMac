import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  HostBinding
} from '@angular/core'

import {
  AudioUnitsService,
  AudioUnitChainItem,
  AvailableAudioUnit,
  AudioUnitsChainChangedEventCallback
} from './audio-units.service'
import { ApplicationService } from '../../../services/app.service'
import { SemanticVersion } from '../../../services/semantic-version.service'
import { UISettings } from '../../../services/ui.service'
import { TranslateService } from '../../../services/translate.service'

// First native version that ships the /effects/audio-units DataBus routes.
// Keep in sync with the actual release version of the Audio Unit hosting
// native feature.
export const AUDIO_UNITS_MIN_NATIVE_VERSION = '1.4.0'

// UISettings extension keys owned by this section. The shared interface in
// ui.service.ts is integration-owned, so they are typed locally here (same
// approach as EffectsUISettings in audio-effects.component.ts).
export interface AudioUnitsUISettings extends UISettings {
  audioUnitsFeatureEnabled?: boolean
}

export interface AvailableAudioUnitItem {
  label: string
  unit: AvailableAudioUnit
}

@Component({
  selector: 'eqm-audio-units',
  templateUrl: './audio-units.component.html',
  styleUrls: [ './audio-units.component.scss' ]
})
export class AudioUnitsComponent implements OnInit, OnDestroy {
  chain: AudioUnitChainItem[] = []
  availableItems: AvailableAudioUnitItem[] = []
  supported = false
  synced = false

  readonly rowHeight = 28
  readonly addRowHeight = 34
  readonly maxVisibleRows = 4
  readonly verticalPadding = 16

  // The eqm-virtual-dropdown instance — captured to reset its internal
  // selection back to the placeholder after a unit has been added
  dropdown: any = null

  constructor (
    public audioUnits: AudioUnitsService,
    public app: ApplicationService,
    public translate: TranslateService,
    public changeRef: ChangeDetectorRef
  ) {}

  // Stable window-height participation (AppComponent sums section heights
  // every second): only changes when the clamped number of chain rows
  // changes — beyond maxVisibleRows the list scrolls internally.
  @HostBinding('style.height.px') get height () {
    if (!this.synced || !this.supported) {
      return this.rowHeight + this.verticalPadding
    }
    const rows = Math.min(Math.max(this.chain.length, 1), this.maxVisibleRows)
    return rows * this.rowHeight + this.addRowHeight + this.verticalPadding
  }

  private onLocaleChangedSubscription: any

  ngOnInit () {
    // Chain rows build their labels in TS (unitLabel) — refresh them when
    // the user switches language
    this.onLocaleChangedSubscription = this.translate.localeChanged
      .subscribe(() => this.detectChanges())
    this.sync()
  }

  async sync () {
    const { version } = await this.app.getInfo()
    this.supported = new SemanticVersion(version).isGreaterThanOrEqualTo(AUDIO_UNITS_MIN_NATIVE_VERSION)
    if (this.supported) {
      await Promise.all([
        this.syncChain(),
        this.syncAvailable()
      ])
      this.setupEvents()
    }
    this.synced = true
    this.detectChanges()
  }

  async syncChain () {
    const chain = await this.audioUnits.getChain()
    this.setChain(chain)
  }

  async syncAvailable () {
    const available = await this.audioUnits.getAvailable()
    this.availableItems = (available || []).map(unit => ({
      label: unit.manufacturerName ? `${unit.manufacturerName}: ${unit.name}` : unit.name,
      unit
    }))
    this.detectChanges()
  }

  setChain (chain: AudioUnitChainItem[]) {
    this.chain = (chain || []).filter(unit => !!(unit && unit.id))
    this.detectChanges()
  }

  trackUnit (index: number, unit: AudioUnitChainItem) {
    return unit.id
  }

  unitLabel (unit: AudioUnitChainItem) {
    if (unit.status === 'loading') return this.translate.instant('audioUnits.unitLoading', { name: unit.name })
    if (unit.status === 'failed') return this.translate.instant('audioUnits.unitFailed', { name: unit.name })
    return unit.name
  }

  private onChainChangedEventCallback: AudioUnitsChainChangedEventCallback

  protected setupEvents () {
    this.onChainChangedEventCallback = data => {
      const chain = AudioUnitsService.parseList<AudioUnitChainItem>(data)
      if (chain) {
        this.setChain(chain)
      } else {
        // Push didn't carry the chain itself — treat it as an invalidation
        this.syncChain()
      }
    }
    this.audioUnits.onChainChanged(this.onChainChangedEventCallback)
  }

  protected destroyEvents () {
    if (this.onChainChangedEventCallback) {
      this.audioUnits.offChainChanged(this.onChainChangedEventCallback)
    }
  }

  // MARK: - Gestures

  addUnit (item: AvailableAudioUnitItem) {
    if (!item || !item.unit) return
    // Reset the dropdown face back to the 'Add Audio Unit' placeholder —
    // this runs synchronously inside itemSelected, before the dropdown's
    // own close() change detection pass
    if (this.dropdown) {
      this.dropdown.selectedItem = null
    }
    this.audioUnits.addToChain(item.unit)
  }

  removeUnit (unit: AudioUnitChainItem) {
    // Optimistic removal — the /chain push converges the authoritative state
    this.chain = this.chain.filter(chainUnit => chainUnit.id !== unit.id)
    this.detectChanges()
    this.audioUnits.removeFromChain(unit.id)
  }

  moveUnit (unit: AudioUnitChainItem, delta: number) {
    const index = this.chain.findIndex(chainUnit => chainUnit.id === unit.id)
    if (index < 0) return
    const newIndex = index + delta
    if (newIndex < 0 || newIndex > this.chain.length - 1) return
    // Optimistic reorder — the /chain push converges the authoritative state
    const chain = [ ...this.chain ]
    chain.splice(index, 1)
    chain.splice(newIndex, 0, unit)
    this.chain = chain
    this.detectChanges()
    this.audioUnits.move(unit.id, newIndex)
  }

  setUnitEnabled (unit: AudioUnitChainItem, enabled: boolean) {
    unit.enabled = enabled
    this.audioUnits.setUnitEnabled(unit.id, enabled)
  }

  openEditor (unit: AudioUnitChainItem) {
    if (unit.status !== 'ready') return
    this.audioUnits.openEditor(unit.id)
  }

  private destroyed = false
  private detectChanges () {
    if (!this.destroyed) {
      this.changeRef.detectChanges()
    }
  }

  ngOnDestroy () {
    this.destroyed = true
    if (this.onLocaleChangedSubscription) {
      this.onLocaleChangedSubscription.unsubscribe()
    }
    this.destroyEvents()
  }
}
