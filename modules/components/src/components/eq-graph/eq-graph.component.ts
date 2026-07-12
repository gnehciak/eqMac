import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  HostBinding,
  HostListener,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core'
import { Subscription } from 'rxjs'
import { UtilitiesService } from '../../services/utilities.service'
import { ColorsService } from '../../services/colors.service'
import {
  EqGraphBand,
  bandResponseDb,
  compositeResponseDb,
  eqBandColor,
  logSpacedFrequencies
} from './biquad-response'

export interface EqGraphBandContextEvent {
  band: EqGraphBand
  /** Page (client) coordinates — for the host to position its context menu */
  x: number
  y: number
}

interface EqGraphCurve {
  id: string
  path: string
  /** Closed path from the curve down to the 0dB baseline (translucent fill) */
  fillPath: string
  color: string
  selected: boolean
  enabled: boolean
}

interface EqGraphCompositeCurve {
  path: string
  color: string
}

interface EqGraphHandle {
  band: EqGraphBand
  x: number
  y: number
  color: string
  selected: boolean
}

interface EqGraphGridLine {
  position: number
  label: string
  emphasized: boolean
}

type EqGraphDragMode = 'move' | 'q'

@Component({
  selector: 'eqm-eq-graph',
  templateUrl: './eq-graph.component.html',
  styleUrls: [ './eq-graph.component.scss' ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EqGraphComponent implements OnInit, OnDestroy {
  constructor (
    public utils: UtilitiesService,
    public colors: ColorsService,
    public elem: ElementRef<HTMLElement>,
    private readonly changeRef: ChangeDetectorRef
  ) {}

  private _bands: EqGraphBand[] = []
  @Input()
  set bands (newBands: EqGraphBand[]) {
    this._bands = Array.isArray(newBands) ? newBands : []
    this.render()
  }

  get bands () { return this._bands }

  private _minGain = -24
  @Input()
  set minGain (value: number) {
    if (typeof value === 'number' && !isNaN(value)) {
      this._minGain = value
      this.render()
    }
  }

  get minGain () { return this._minGain }

  private _maxGain = 24
  @Input()
  set maxGain (value: number) {
    if (typeof value === 'number' && !isNaN(value)) {
      this._maxGain = value
      this.render()
    }
  }

  get maxGain () { return this._maxGain }

  private _sampleRate = 44100
  @Input()
  set sampleRate (value: number) {
    if (typeof value === 'number' && value > 0) {
      this._sampleRate = value
      this.render()
    }
  }

  get sampleRate () { return this._sampleRate }

  @Input() minFrequency = 20
  @Input() maxFrequency = 20000
  @Input() minQ = 0.1
  @Input() maxQ = 10
  @Input() curvePoints = 128
  @Input() showGrid = true
  @Input() showLabels = true
  @Input() handleRadius = 5

  @HostBinding('class.enabled') @Input() enabled = true

  private _selectedBandId?: string | null = null
  @Input()
  set selectedBandId (id: string | null | undefined) {
    this._selectedBandId = id
    this.render()
  }

  get selectedBandId () { return this._selectedBandId }

  @Output() bandChanged = new EventEmitter<EqGraphBand>()
  @Output() bandAdded = new EventEmitter<EqGraphBand>()
  @Output() bandRemoved = new EventEmitter<EqGraphBand>()
  @Output() bandSelected = new EventEmitter<EqGraphBand | null>()
  @Output() bandContext = new EventEmitter<EqGraphBandContextEvent>()

  width = 440
  height = 220

  bandCurves: EqGraphCurve[] = []
  composites: EqGraphCompositeCurve[] = []
  handles: EqGraphHandle[] = []
  freqGridLines: EqGraphGridLine[] = []
  gainGridLines: EqGraphGridLine[] = []

  hoveredBandId?: string | null = null

  private draggingBand?: EqGraphBand | null = null
  private dragMode: EqGraphDragMode = 'move'
  private dragMoved = false
  private dragFromBackground = false
  private dragStartClientY = 0
  private dragStartQ = 1

  get viewBox () {
    return `0 0 ${this.width} ${this.height}`
  }

  get selectedBand (): EqGraphBand | null {
    return this.bands.find(band => band.id === this._selectedBandId) ?? null
  }

  get hoveredBand (): EqGraphBand | null {
    return this.bands.find(band => band.id === this.hoveredBandId) ?? null
  }

  private themeChangedSubscription?: Subscription

  async ngOnInit () {
    // Re-render on theme swaps so curve / composite colors pick up the new tokens
    this.themeChangedSubscription = this.colors.themeChanged.subscribe(() => this.render())
    this.measure()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of [ ...Array(3) ]) {
      await this.utils.delay(100)
      this.measure()
    }
  }

  @HostListener('window:resize')
  onWindowResize () {
    this.measure()
  }

  private measure () {
    const el = this.elem.nativeElement
    const width = el.offsetWidth
    const height = el.offsetHeight
    if (width > 0 && height > 0 && (width !== this.width || height !== this.height)) {
      this.width = width
      this.height = height
    }
    this.render()
  }

  // MARK: - Coordinate mapping (log-x frequency, linear-y dB)

  freqToX (frequency: number) {
    return this.utils.logMapValueInverse({
      value: frequency,
      inMin: this.minFrequency,
      inMax: this.maxFrequency,
      outMin: 0,
      outMax: this.width
    })
  }

  xToFreq (x: number) {
    return this.utils.logMapValue({
      value: x,
      inMin: 0,
      inMax: this.width,
      outMin: this.minFrequency,
      outMax: this.maxFrequency
    })
  }

  gainToY (gain: number) {
    return this.utils.mapValue(gain, this.maxGain, this.minGain, 0, this.height)
  }

  yToGain (y: number) {
    return this.utils.mapValue(y, 0, this.height, this.maxGain, this.minGain)
  }

  // MARK: - Rendering

  private render () {
    const frequencies = logSpacedFrequencies(this.curvePoints, this.minFrequency, this.maxFrequency)

    this.bandCurves = this.bands.map((band, index) => {
      const response = bandResponseDb(band, frequencies, this.sampleRate)
      return {
        id: band.id,
        path: this.buildPath(response, frequencies),
        fillPath: this.buildFillPath(response, frequencies),
        color: this.bandColor(index),
        selected: band.id === this._selectedBandId,
        enabled: band.enabled
      }
    })

    // Bold near-white composite drawn over the colored per-band hills
    const stereo = this.bands.some(band => band.enabled && band.channel !== 'both')
    const leftResponse = compositeResponseDb(this.bands, frequencies, this.sampleRate, 'left')
    this.composites = [ {
      path: this.buildPath(leftResponse, frequencies),
      color: this.colors.light
    } ]
    if (stereo) {
      const rightResponse = compositeResponseDb(this.bands, frequencies, this.sampleRate, 'right')
      this.composites.push({
        path: this.buildPath(rightResponse, frequencies),
        color: this.colors.warning
      })
    }

    this.handles = this.bands.map((band, index) => ({
      band,
      x: this.freqToX(this.clamp(band.frequency, this.minFrequency, this.maxFrequency)),
      y: this.gainToY(this.clamp(band.gain, this.minGain, this.maxGain)),
      color: this.bandColor(index),
      selected: band.id === this._selectedBandId
    }))

    this.buildGrid()
    this.changeRef.detectChanges()
  }

  /**
   * Pro-style fixed rainbow ramp by band index (wraps after 10) — public so
   * hosts (e.g. the Expert EQ band strips) can match their chrome to the
   * curve colors. Delegates to the exported `eqBandColor` helper.
   */
  bandColor (index: number): string {
    return eqBandColor(index)
  }

  private buildPath (dbValues: number[], frequencies: number[]) {
    if (!dbValues.length) return ''
    const segments: string[] = []
    for (let i = 0; i < dbValues.length; i++) {
      const x = this.freqToX(frequencies[i])
      const y = this.clamp(this.gainToY(dbValues[i]), -10, this.height + 10)
      segments.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    }
    return segments.join(' ')
  }

  /** Same polyline closed down to the 0dB baseline for the translucent hill fill */
  private buildFillPath (dbValues: number[], frequencies: number[]) {
    const path = this.buildPath(dbValues, frequencies)
    if (!path) return ''
    const baseline = this.clamp(this.gainToY(0), 0, this.height)
    const firstX = this.freqToX(frequencies[0])
    const lastX = this.freqToX(frequencies[frequencies.length - 1])
    return `${path} L ${lastX.toFixed(2)} ${baseline.toFixed(2)} L ${firstX.toFixed(2)} ${baseline.toFixed(2)} Z`
  }

  private buildGrid () {
    const freqMarks = [ 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000 ]
    this.freqGridLines = freqMarks
      .filter(frequency => frequency >= this.minFrequency && frequency <= this.maxFrequency)
      .map(frequency => ({
        position: this.freqToX(frequency),
        label: frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`,
        emphasized: false
      }))

    const range = this.maxGain - this.minGain
    const step = range <= 24 ? 3 : (range <= 48 ? 6 : 12)
    this.gainGridLines = []
    const first = Math.ceil(this.minGain / step) * step
    for (let gain = first; gain <= this.maxGain; gain += step) {
      this.gainGridLines.push({
        position: this.gainToY(gain),
        label: `${gain > 0 ? '+' : ''}${gain}`,
        emphasized: gain === 0
      })
    }
  }

  // MARK: - Interaction

  onHandleMouseDown (event: MouseEvent, band: EqGraphBand) {
    if (!this.enabled) return
    event.preventDefault()
    event.stopPropagation()
    this.selectBand(band)
    this.draggingBand = band
    this.dragMode = event.altKey ? 'q' : 'move'
    this.dragMoved = false
    this.dragFromBackground = false
    this.dragStartClientY = event.clientY
    this.dragStartQ = band.q
  }

  onBackgroundMouseDown (event: MouseEvent) {
    if (!this.enabled) return
    event.preventDefault()
    const selected = this.selectedBand
    if (selected) {
      // Drag while a band is selected updates that band
      this.draggingBand = selected
      this.dragMode = event.altKey ? 'q' : 'move'
      this.dragMoved = false
      this.dragFromBackground = true
      this.dragStartClientY = event.clientY
      this.dragStartQ = selected.q
    } else {
      this.draggingBand = null
      this.dragFromBackground = true
      this.dragMoved = false
    }
  }

  onBackgroundDoubleClick (event: MouseEvent) {
    if (!this.enabled) return
    event.preventDefault()
    const coords = this.utils.getCoordinatesInsideElementFromEvent(event, this.elem.nativeElement)
    const band: EqGraphBand = {
      id: `band-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'peak',
      frequency: this.roundFrequency(this.clamp(this.xToFreq(coords.x), this.minFrequency, this.maxFrequency)),
      gain: this.roundGain(this.clamp(this.yToGain(coords.y), this.minGain, this.maxGain)),
      q: 1.41,
      channel: 'both',
      enabled: true
    }
    this._selectedBandId = band.id
    this.bandAdded.emit(band)
    this.bandSelected.emit(band)
    this.render()
  }

  onHandleDoubleClick (event: MouseEvent, band: EqGraphBand) {
    if (!this.enabled) return
    event.preventDefault()
    event.stopPropagation()
    this.removeBand(band)
  }

  onHandleContext (event: MouseEvent, band: EqGraphBand) {
    if (!this.enabled) return
    event.preventDefault()
    event.stopPropagation()
    this.selectBand(band)
    this.bandContext.emit({
      band,
      x: event.clientX,
      y: event.clientY
    })
    this.render()
  }

  onHandleMouseEnter (band: EqGraphBand) {
    this.hoveredBandId = band.id
  }

  onHandleMouseLeave () {
    this.hoveredBandId = null
  }

  @HostListener('mousemove', [ '$event' ])
  mousemove = (event: MouseEvent) => {
    if (!this.enabled || !this.draggingBand) return
    this.dragMoved = true
    const band = this.draggingBand
    if (this.dragMode === 'q') {
      band.q = this.roundQ(this.clamp(
        this.dragStartQ * Math.pow(2, (this.dragStartClientY - event.clientY) / 60),
        this.minQ,
        this.maxQ
      ))
    } else {
      const coords = this.utils.getCoordinatesInsideElementFromEvent(event, this.elem.nativeElement)
      band.frequency = this.roundFrequency(this.clamp(this.xToFreq(coords.x), this.minFrequency, this.maxFrequency))
      band.gain = this.roundGain(this.clamp(this.yToGain(coords.y), this.minGain, this.maxGain))
    }
    this.bandChanged.emit(band)
    this.render()
  }

  @HostListener('mouseup', [ '$event' ])
  mouseup = (event: MouseEvent) => {
    if (this.dragFromBackground && !this.dragMoved && this.selectedBand) {
      // A plain click on the empty area deselects
      this._selectedBandId = null
      this.bandSelected.emit(null)
      this.render()
    }
    this.draggingBand = null
    this.dragFromBackground = false
    this.dragMoved = false
    this.dettachWindowEvents()
  }

  @HostListener('mouseleave', [ '$event' ])
  mouseleave () {
    if (this.draggingBand) {
      this.attachWindowEvents()
    }
  }

  @HostListener('mouseenter', [ '$event' ])
  mouseenter () {
    if (this.windowEventsAttached) {
      this.dettachWindowEvents()
    }
  }

  private windowEventsAttached = false
  private attachWindowEvents () {
    if (this.windowEventsAttached) return
    this.windowEventsAttached = true
    window.addEventListener('mousemove', this.mousemove, true)
    window.addEventListener('mouseup', this.mouseup, true)
  }

  private dettachWindowEvents () {
    window.removeEventListener('mousemove', this.mousemove, true)
    window.removeEventListener('mouseup', this.mouseup, true)
    this.windowEventsAttached = false
  }

  private lastWheelEvent = new Date().getTime()
  private readonly wheelDebouncer = 1000 / 30
  @HostListener('mousewheel', [ '$event' ])
  mouseWheel (event: WheelEvent) {
    if (!this.enabled) return
    const band = this.hoveredBand ?? this.selectedBand
    if (!band) return
    event.preventDefault()
    const now = new Date().getTime()
    if (now - this.lastWheelEvent < this.wheelDebouncer) return
    this.lastWheelEvent = now
    const changeDelta = -event.deltaY
    const diff = changeDelta < 0 ? -changeDelta : changeDelta
    if (diff < 2) return
    band.q = this.roundQ(this.clamp(band.q * Math.pow(2, changeDelta / 400), this.minQ, this.maxQ))
    this.bandChanged.emit(band)
    this.render()
  }

  @HostListener('document:keydown', [ '$event' ])
  keydown (event: KeyboardEvent) {
    if (!this.enabled) return
    const band = this.selectedBand
    if (!band) return
    const target = event.target as HTMLElement | null
    if (target && [ 'INPUT', 'TEXTAREA', 'SELECT' ].includes(target.tagName)) return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      this.removeBand(band)
    }
  }

  private selectBand (band: EqGraphBand) {
    if (this._selectedBandId !== band.id) {
      this._selectedBandId = band.id
      this.bandSelected.emit(band)
    }
  }

  private removeBand (band: EqGraphBand) {
    if (this._selectedBandId === band.id) {
      this._selectedBandId = null
      this.bandSelected.emit(null)
    }
    if (this.hoveredBandId === band.id) {
      this.hoveredBandId = null
    }
    this.bandRemoved.emit(band)
    this.render()
  }

  // MARK: - Helpers

  private clamp (value: number, min: number, max: number) {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  private roundFrequency (frequency: number) {
    return Math.round(frequency * 10) / 10
  }

  private roundGain (gain: number) {
    return Math.round(gain * 10) / 10
  }

  private roundQ (q: number) {
    return Math.round(q * 100) / 100
  }

  trackByBandId (index: number, item: { id: string }) {
    return item.id
  }

  trackByHandle (index: number, item: EqGraphHandle) {
    return item.band.id
  }

  trackByIndex (index: number) {
    return index
  }

  ngOnDestroy () {
    if (this.themeChangedSubscription) {
      this.themeChangedSubscription.unsubscribe()
      this.themeChangedSubscription = undefined
    }
    this.dettachWindowEvents()
  }
}
