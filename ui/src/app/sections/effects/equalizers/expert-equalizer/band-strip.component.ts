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
import {
  FlatSliderValueChangedEvent,
  KnobValueChangedEvent,
  eqBandColor
} from '@eqmac/components'
import {
  ExpertEqualizerBand,
  ExpertEqualizerFilterType
} from './expert-equalizer.service'
import { TranslateService } from '../../../../services/translate.service'

/**
 * Tiny inline-SVG glyphs (viewBox 0 0 20 12) sketching each biquad filter
 * type's magnitude response — peak bump, shelf curves, pass slopes etc.
 */
const FILTER_TYPE_GLYPHS: { [type in ExpertEqualizerFilterType]: string } = {
  peak: 'M1 9 C6 9 6 3 10 3 C14 3 14 9 19 9',
  lowPass: 'M1 4 L8 4 C12 4 13 10 17 10',
  highPass: 'M3 10 C7 10 8 4 12 4 L19 4',
  lowShelf: 'M1 4 C7 4 9 9 19 9',
  highShelf: 'M1 9 C11 9 13 4 19 4',
  bandPass: 'M1 10 L5 10 C7 10 7 3 10 3 C13 3 13 10 15 10 L19 10',
  notch: 'M1 4 L5 4 C7 4 7 10 10 10 C13 10 13 4 15 4 L19 4',
  allPass: 'M1 6 L19 6 M12 3 L8 9'
}

/**
 * Pro-style horizontal row of per-band vertical strips rendered below the
 * eq-graph. Each strip: colored enable chip (band ramp color), filter-type
 * glyph, frequency label, vertical gain slider over fine tick marks, gain
 * value, small Q knob with value, and edit / remove buttons.
 *
 * Bands are mutated in place (same contract as the eq-graph and the band
 * inspector) and `bandChange` fires so the host can re-render + persist.
 */
@Component({
  selector: 'eqm-expert-band-strips',
  templateUrl: './band-strip.component.html',
  styleUrls: [ './band-strip.component.scss' ]
})
export class BandStripComponent implements OnInit, OnDestroy {
  @Input() bands: ExpertEqualizerBand[] = []
  @Input() selectedBandId: string | null = null
  @Input() enabled = true
  @Input() minGain = -24
  @Input() maxGain = 24
  @Input() minQ = 0.1
  @Input() maxQ = 10

  /** Emitted after a strip control mutated the band object's parameters */
  @Output() bandChange = new EventEmitter<ExpertEqualizerBand>()
  @Output() bandSelect = new EventEmitter<ExpertEqualizerBand>()
  @Output() bandRemove = new EventEmitter<ExpertEqualizerBand>()
  /** Pencil button — the host opens the band inspector popover */
  @Output() bandEdit = new EventEmitter<ExpertEqualizerBand>()

  private localeChangedSubscription: Subscription
  private readonly typeNames: { [type in ExpertEqualizerFilterType]?: string } = {}

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
    for (const type of Object.keys(FILTER_TYPE_GLYPHS) as ExpertEqualizerFilterType[]) {
      this.typeNames[type] = this.translate.instant(`equalizers.filterTypes.${type}`)
    }
  }

  /** Same fixed rainbow ramp the eq-graph curves use (by band index) */
  color (index: number): string {
    return eqBandColor(index)
  }

  typePath (type: ExpertEqualizerFilterType): string {
    return FILTER_TYPE_GLYPHS[type] || FILTER_TYPE_GLYPHS.peak
  }

  typeName (type: ExpertEqualizerFilterType): string {
    return this.typeNames[type] || ''
  }

  frequencyLabel (band: ExpertEqualizerBand): string {
    const frequency = band.frequency
    if (frequency >= 1000) {
      const kilos = frequency / 1000
      const digits = kilos >= 10 ? 1 : 2
      return `${parseFloat(kilos.toFixed(digits))}kHz`
    }
    return `${Math.round(frequency)}Hz`
  }

  gainLabel (band: ExpertEqualizerBand): string {
    return `${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)}dB`
  }

  qLabel (band: ExpertEqualizerBand): string {
    return band.q.toFixed(2)
  }

  select (band: ExpertEqualizerBand) {
    if (!this.enabled) return
    if (this.selectedBandId !== band.id) {
      this.bandSelect.emit(band)
    }
  }

  setEnabled (band: ExpertEqualizerBand, enabled: boolean) {
    band.enabled = enabled
    this.emitChange(band)
  }

  setGain (band: ExpertEqualizerBand, event: FlatSliderValueChangedEvent) {
    band.gain = Math.round(event.value * 10) / 10
    this.emitChange(band)
  }

  setQ (band: ExpertEqualizerBand, event: KnobValueChangedEvent) {
    band.q = Math.round(event.value * 100) / 100
    this.emitChange(band)
  }

  edit (band: ExpertEqualizerBand) {
    this.bandEdit.emit(band)
  }

  remove (band: ExpertEqualizerBand) {
    this.bandRemove.emit(band)
  }

  private emitChange (band: ExpertEqualizerBand) {
    this.change.detectChanges()
    this.bandChange.emit(band)
  }

  trackById (index: number, band: ExpertEqualizerBand) {
    return band.id
  }
}
