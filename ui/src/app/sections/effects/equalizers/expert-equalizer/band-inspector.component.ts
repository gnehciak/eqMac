import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  OnInit,
  OnDestroy
} from '@angular/core'
import { Subscription } from 'rxjs'
import { FlatSliderValueChangedEvent } from '@eqmac/components'
import {
  ExpertEqualizerBand,
  ExpertEqualizerBandChannel,
  ExpertEqualizerFilterType
} from './expert-equalizer.service'
import { TranslateService } from '../../../../services/translate.service'

export interface ExpertEqualizerFilterTypeItem {
  id: ExpertEqualizerFilterType
  name: string
}

/**
 * Per-selected-band parameter editor: filter type dropdown, frequency /
 * gain / Q sliders with value screens, L / R / Both channel toggle, enable
 * checkbox, delete band button. Since the Pro-style restyle it renders as a
 * popover over the band strips, opened via a strip's pencil button
 * (showClose + closed wire the popover dismissal).
 *
 * Styles are inline (styles array) — this component deliberately ships
 * without its own .scss file.
 */
@Component({
  selector: 'eqm-expert-band-inspector',
  templateUrl: './band-inspector.component.html',
  styles: [ `
    :host {
      display: block;
      width: 100%;
      height: 64px;
      padding: 4px 5px 2px 5px;
      box-sizing: border-box;
    }

    .inspector-row {
      height: 26px;
    }

    .type-dropdown {
      width: 110px;
      min-width: 110px;
    }

    .slider-group {
      min-width: 0;
    }

    .slider-container {
      min-width: 30px;
    }

    .param-label {
      min-width: 24px;
      text-align: right;
    }

    .screen {
      min-width: 52px;
      text-align: center;
    }
  ` ]
})
export class BandInspectorComponent implements OnInit, OnDestroy {
  @Input() band: ExpertEqualizerBand | null = null
  @Input() enabled = true
  /** Shows the popover close button (the host toggles the popover) */
  @Input() showClose = false

  /** Emitted after this component mutated the band object's parameters */
  @Output() bandChange = new EventEmitter<ExpertEqualizerBand>()
  @Output() bandRemove = new EventEmitter<ExpertEqualizerBand>()
  @Output() closed = new EventEmitter<void>()

  // Labels come from the i18n catalog — retranslated in place on locale
  // change so the dropdown's selected item reference stays valid
  readonly filterTypes: ExpertEqualizerFilterTypeItem[] = [
    { id: 'peak', name: '' },
    { id: 'lowPass', name: '' },
    { id: 'highPass', name: '' },
    { id: 'lowShelf', name: '' },
    { id: 'highShelf', name: '' },
    { id: 'bandPass', name: '' },
    { id: 'notch', name: '' },
    { id: 'allPass', name: '' }
  ]

  private localeChangedSubscription: Subscription

  constructor (
    public change: ChangeDetectorRef,
    private readonly translate: TranslateService
  ) {
    this.applyTranslations()
  }

  ngOnInit () {
    this.localeChangedSubscription = this.translate.localeChanged.subscribe(() => {
      this.applyTranslations()
      this.change.detectChanges()
    })
  }

  ngOnDestroy () {
    if (this.localeChangedSubscription) {
      this.localeChangedSubscription.unsubscribe()
    }
  }

  private applyTranslations () {
    for (const item of this.filterTypes) {
      item.name = this.translate.instant(`equalizers.filterTypes.${item.id}`)
    }
  }

  get selectedFilterTypeItem (): ExpertEqualizerFilterTypeItem | null {
    const band = this.band
    if (!band) return null
    return this.filterTypes.find(item => item.id === band.type) || null
  }

  get frequencyScreenValue () {
    if (!this.band) return ''
    const frequency = this.band.frequency
    return frequency >= 1000 ? `${(frequency / 1000).toFixed(1)}kHz` : `${frequency.toFixed(0)}Hz`
  }

  get gainScreenValue () {
    if (!this.band) return ''
    const gain = this.band.gain
    return `${gain > 0 ? '+' : ''}${gain.toFixed(1)}dB`
  }

  get qScreenValue () {
    if (!this.band) return ''
    return `Q ${this.band.q.toFixed(2)}`
  }

  selectFilterType (item: ExpertEqualizerFilterTypeItem) {
    if (!this.band || !item) return
    this.band.type = item.id
    this.emitChange()
  }

  setFrequency (event: FlatSliderValueChangedEvent) {
    if (!this.band) return
    this.band.frequency = Math.round(event.value * 10) / 10
    this.emitChange()
  }

  setGain (event: FlatSliderValueChangedEvent) {
    if (!this.band) return
    this.band.gain = Math.round(event.value * 10) / 10
    this.emitChange()
  }

  setQ (event: FlatSliderValueChangedEvent) {
    if (!this.band) return
    this.band.q = Math.round(event.value * 100) / 100
    this.emitChange()
  }

  setChannel (channel: ExpertEqualizerBandChannel) {
    if (!this.band || this.band.channel === channel) return
    this.band.channel = channel
    this.emitChange()
  }

  setEnabled (enabled: boolean) {
    if (!this.band) return
    this.band.enabled = enabled
    this.emitChange()
  }

  remove () {
    if (!this.band) return
    this.bandRemove.emit(this.band)
  }

  private emitChange () {
    this.change.detectChanges()
    this.bandChange.emit(this.band)
  }
}
