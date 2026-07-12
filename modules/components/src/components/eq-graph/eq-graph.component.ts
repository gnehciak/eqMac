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
  ViewChild,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core'
import { Observable, Subscription } from 'rxjs'
import { UtilitiesService } from '../../services/utilities.service'
import { ColorsService } from '../../services/colors.service'
import {
  EqGraphBand,
  bandResponseDb,
  compositeResponseDb,
  eqBandColor,
  logSpacedFrequencies
} from './biquad-response'

// MARK: - Shared spectrum axis contract
//
// Single source of truth for the live-spectrum dB range and log-x placement so
// the internal spectrum underlay drawn here and the standalone <eqm-spectrum>
// component (which imports these) map identical frames to identical pixels and
// can be layered / swapped interchangeably. Matches the Console reference mock
// (spectrum scale roughly -96..+20 dBFS, log-spaced bins over 20Hz..20kHz).

/** Bottom of the spectrum dBFS scale (quietest represented magnitude) */
export const SPECTRUM_FLOOR_DB = -96
/** Top of the spectrum dBFS scale (loudest represented magnitude, with headroom) */
export const SPECTRUM_CEIL_DB = 20

/**
 * X position (in the graph's pixel space) of spectrum bin `index` of
 * `binCount`. Frames are log-spaced over 20Hz..20kHz, so equal bin index ==
 * equal log-frequency == equal x on the graph's log-x axis: bin i sits at
 * i / (binCount - 1) of the width — exactly where eqm-eq-graph's log-x axis
 * puts that frequency.
 */
export function spectrumBinX (index: number, binCount: number, width: number): number {
  return binCount <= 1 ? 0 : (index / (binCount - 1)) * width
}

/**
 * Maps a spectrum magnitude in dBFS to a 0..1 vertical ratio (0 = top of the
 * graph, 1 = bottom) on the shared spectrum scale. Used for the left-hand
 * dBFS axis labels; clamps outside [floorDb, ceilDb].
 */
export function spectrumDbToYRatio (
  db: number,
  floorDb: number = SPECTRUM_FLOOR_DB,
  ceilDb: number = SPECTRUM_CEIL_DB
): number {
  const span = (ceilDb - floorDb) || 1
  let ratio = (db - floorDb) / span
  if (ratio < 0) ratio = 0
  if (ratio > 1) ratio = 1
  return 1 - ratio
}

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

  // MARK: - Spectrum underlay inputs
  //
  // The live spectrum renders behind the band curves on an internal canvas
  // layer so the graph is one layered surface (per the Console redesign). It
  // stays completely inert — canvas cleared, no animation loop — until a
  // `spectrumFrames` observable is bound, so a host that underlays a separate
  // <eqm-spectrum> sibling instead is unaffected.

  /** Show the live-spectrum underlay (still requires `spectrumFrames`) */
  @Input() showSpectrum = true
  /** Bottom of the spectrum dBFS scale (see SPECTRUM_FLOOR_DB) */
  @Input() spectrumMinDb = SPECTRUM_FLOOR_DB
  /** Top of the spectrum dBFS scale (see SPECTRUM_CEIL_DB) */
  @Input() spectrumMaxDb = SPECTRUM_CEIL_DB

  private _spectrumFrames?: Observable<number[]> | null = null
  /**
   * Live FFT magnitude frames (dBFS, log-spaced bins over 20Hz..20kHz — the
   * same stream `<eqm-spectrum [frames]>` accepts). When bound, the underlay
   * animates with peak-hold decay whenever the graph is visible, in every EQ
   * mode; when the observable is silent it settles to the floor rather than
   * vanishing.
   */
  @Input()
  set spectrumFrames (observable: Observable<number[]> | null | undefined) {
    this._spectrumFrames = observable ?? null
    this.unsubscribeFromSpectrum()
    if (observable) {
      this.spectrumSubscription = observable.subscribe(frame => this.onSpectrumFrame(frame))
    }
    // Reflect the active/inert state right away (draw the floor or clear)
    this.drawSpectrum()
    if (this._spectrumFrames && this.specVisible) this.startSpectrumLoop()
  }

  get spectrumFrames () { return this._spectrumFrames }

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
  /** Left-hand spectrum dBFS axis labels (0, -24, -48, -72) */
  spectrumScaleLines: EqGraphGridLine[] = []

  @ViewChild('spectrumCanvas', { static: true }) spectrumCanvasRef?: ElementRef<HTMLCanvasElement>

  // Spectrum underlay engine state (imperative canvas; independent of the
  // SVG's OnPush change detection)
  private spectrumSubscription?: Subscription
  private specTargets = new Float32Array(0)
  private specDisplayed = new Float32Array(0)
  private specPeaks = new Float32Array(0)
  private specPeakTimestamps = new Float32Array(0)
  private specAnimationFrame?: number
  private specIntervalId?: ReturnType<typeof setInterval>
  private specRunning = false
  private specVisible = true
  private specLastFrameAt = 0
  private specLastTickAt = 0
  private readonly specIdleTimeoutMs = 2000
  private readonly specDecayPerSecond = 1.5
  private readonly specPeakHoldMs = 1000
  private readonly specPeakDecayPerSecond = 0.4
  private specCssWidth = 0
  private specCssHeight = 0
  // Resolved at construction (before Angular binds inputs) so an early
  // spectrumFrames binding under reduced motion still takes the 1 fps path
  private reducedMotion = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private spectrumIntersectionObserver?: IntersectionObserver

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
    this.themeChangedSubscription = this.colors.themeChanged.subscribe(() => {
      this.render()
      this.drawSpectrum()
    })
    this.measure()
    this.resizeSpectrumCanvas()
    this.setupSpectrumVisibility()
    // Paint the floor / start the loop if frames were bound before view init
    this.drawSpectrum()
    if (this._spectrumFrames && this.specVisible) this.startSpectrumLoop()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of [ ...Array(3) ]) {
      await this.utils.delay(100)
      this.measure()
      this.resizeSpectrumCanvas()
      this.drawSpectrum()
    }
  }

  @HostListener('window:resize')
  onWindowResize () {
    this.measure()
    this.resizeSpectrumCanvas()
    this.drawSpectrum()
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
    // Log-spaced frequency gridlines (decade anchors brighter, per the mock)
    const freqMarks = [ 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000 ]
    const emphasizedMarks = [ 100, 1000, 10000 ]
    this.freqGridLines = freqMarks
      .filter(frequency => frequency >= this.minFrequency && frequency <= this.maxFrequency)
      .map(frequency => ({
        position: this.freqToX(frequency),
        label: frequency >= 1000 ? `${frequency / 1000}K` : `${frequency}`,
        emphasized: emphasizedMarks.includes(frequency)
      }))

    // Horizontal EQ-gain gridlines (right-hand axis). Interior lines only —
    // the extreme min/max sit on the border, so the mock draws e.g. ±18 on a
    // ±24 scale, with the 0 dB line emphasized.
    const range = this.maxGain - this.minGain
    const step = range <= 24 ? 3 : (range <= 48 ? 6 : 12)
    this.gainGridLines = []
    const first = Math.ceil(this.minGain / step) * step
    for (let gain = first; gain <= this.maxGain; gain += step) {
      if (gain <= this.minGain || gain >= this.maxGain) continue
      this.gainGridLines.push({
        position: this.gainToY(gain),
        label: `${gain > 0 ? '+' : ''}${gain}`,
        emphasized: gain === 0
      })
    }

    // Left-hand spectrum dBFS scale labels (text only, no gridlines — the
    // horizontal lines belong to the EQ-gain axis)
    this.spectrumScaleLines = [ 0, -24, -48, -72 ]
      .filter(db => db >= this.spectrumMinDb && db <= this.spectrumMaxDb)
      .map(db => ({
        position: spectrumDbToYRatio(db, this.spectrumMinDb, this.spectrumMaxDb) * this.height,
        label: `${db}`,
        emphasized: false
      }))
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

  // MARK: - Spectrum underlay
  //
  // Renders the live spectrum as a warning-red translucent area (current
  // magnitudes) plus a brighter peak-hold line, on a canvas layered behind the
  // SVG band curves. Fast attack / slow release, peak-hold decay. Runs on rAF
  // while visible; falls back to a 1 fps interval under prefers-reduced-motion.

  private setupSpectrumVisibility () {
    if (typeof IntersectionObserver === 'undefined') return
    this.spectrumIntersectionObserver = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]
      this.specVisible = !!entry && entry.isIntersecting
      if (this.specVisible) {
        this.drawSpectrum()
        this.startSpectrumLoop()
      } else {
        this.stopSpectrumLoop()
      }
    })
    this.spectrumIntersectionObserver.observe(this.elem.nativeElement)
  }

  private onSpectrumFrame (frame: number[]) {
    if (!frame || !frame.length) return
    if (this.specTargets.length !== frame.length) {
      this.specTargets = new Float32Array(frame.length)
      this.specDisplayed = new Float32Array(frame.length)
      this.specPeaks = new Float32Array(frame.length)
      this.specPeakTimestamps = new Float32Array(frame.length)
    }
    const range = (this.spectrumMaxDb - this.spectrumMinDb) || 1
    for (let i = 0; i < frame.length; i++) {
      let normalized = (frame[i] - this.spectrumMinDb) / range
      if (normalized < 0) normalized = 0
      if (normalized > 1) normalized = 1
      this.specTargets[i] = normalized
    }
    this.specLastFrameAt = performance.now()
    this.startSpectrumLoop()
  }

  private startSpectrumLoop () {
    if (this.specRunning || !this.specVisible || !this.showSpectrum || !this._spectrumFrames) return
    this.specRunning = true
    this.specLastTickAt = performance.now()
    if (this.reducedMotion) {
      this.drawSpectrum()
      // 1 fps fallback — decay still resolves, just coarsely; the interval
      // keeps the floor alive so the trace never blanks out
      this.specIntervalId = setInterval(() => this.advanceSpectrum(performance.now()), 1000)
    } else {
      this.specAnimationFrame = requestAnimationFrame(this.spectrumTick)
    }
  }

  private stopSpectrumLoop () {
    this.specRunning = false
    if (this.specAnimationFrame !== undefined) {
      cancelAnimationFrame(this.specAnimationFrame)
      this.specAnimationFrame = undefined
    }
    if (this.specIntervalId !== undefined) {
      clearInterval(this.specIntervalId)
      this.specIntervalId = undefined
    }
  }

  private readonly spectrumTick = (now: number) => {
    this.specAnimationFrame = undefined
    if (!this.specRunning) return
    const idle = this.advanceSpectrum(now)
    if (idle) {
      // Nothing left to animate — park at the floor until the next frame
      this.specRunning = false
      return
    }
    this.specAnimationFrame = requestAnimationFrame(this.spectrumTick)
  }

  private advanceSpectrum (now: number): boolean {
    const dt = Math.min((now - this.specLastTickAt) / 1000, this.reducedMotion ? 1.1 : 0.1)
    this.specLastTickAt = now
    let energy = 0
    const decay = this.specDecayPerSecond * dt
    const peakDecay = this.specPeakDecayPerSecond * dt
    for (let i = 0; i < this.specDisplayed.length; i++) {
      const target = this.specTargets[i]
      const fallen = this.specDisplayed[i] - decay
      this.specDisplayed[i] = target > fallen ? target : (fallen > 0 ? fallen : 0)

      if (this.specDisplayed[i] >= this.specPeaks[i]) {
        this.specPeaks[i] = this.specDisplayed[i]
        this.specPeakTimestamps[i] = now
      } else if (now - this.specPeakTimestamps[i] > this.specPeakHoldMs) {
        const peakFallen = this.specPeaks[i] - peakDecay
        this.specPeaks[i] = peakFallen > this.specDisplayed[i] ? peakFallen : this.specDisplayed[i]
      }
      energy += this.specPeaks[i] + this.specDisplayed[i]
    }
    this.drawSpectrum()
    return (now - this.specLastFrameAt) > this.specIdleTimeoutMs && energy < 0.001
  }

  private resizeSpectrumCanvas () {
    const canvas = this.spectrumCanvasRef?.nativeElement
    if (!canvas) return
    const width = this.elem.nativeElement.offsetWidth
    const height = this.elem.nativeElement.offsetHeight
    if (!width || !height) return
    if (width === this.specCssWidth && height === this.specCssHeight) return
    this.specCssWidth = width
    this.specCssHeight = height
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (context) context.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private rgba (hex: string, alpha: number) {
    const { r, g, b } = this.utils.hexToRgb(hex)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  private drawSpectrum () {
    const canvas = this.spectrumCanvasRef?.nativeElement
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    if (this.elem.nativeElement.offsetWidth !== this.specCssWidth ||
        this.elem.nativeElement.offsetHeight !== this.specCssHeight) {
      this.resizeSpectrumCanvas()
    }
    const width = this.specCssWidth
    const height = this.specCssHeight
    if (!width || !height) return

    context.clearRect(0, 0, width, height)
    // Inert (transparent) unless a frames observable is bound — so hosts that
    // underlay a separate <eqm-spectrum> sibling see nothing drawn here.
    if (!this.showSpectrum || !this._spectrumFrames) return

    const areaColor = this.rgba(this.colors.warning, 0.16)
    const lineColor = this.rgba(this.colors.warning, 0.6)
    const n = this.specDisplayed.length

    // Area under the current magnitudes (floor when there are no bins yet)
    context.beginPath()
    context.moveTo(0, height)
    for (let i = 0; i < n; i++) {
      context.lineTo(spectrumBinX(i, n, width), height * (1 - this.specDisplayed[i]))
    }
    context.lineTo(width, height)
    context.closePath()
    context.fillStyle = areaColor
    context.fill()

    // Brighter peak-hold line
    context.beginPath()
    if (n) {
      for (let i = 0; i < n; i++) {
        const y = height * (1 - this.specPeaks[i])
        if (i) context.lineTo(spectrumBinX(i, n, width), y)
        else context.moveTo(spectrumBinX(i, n, width), y)
      }
    } else {
      context.moveTo(0, height)
      context.lineTo(width, height)
    }
    context.strokeStyle = lineColor
    context.lineWidth = 1.2
    context.stroke()
  }

  private unsubscribeFromSpectrum () {
    if (this.spectrumSubscription) {
      this.spectrumSubscription.unsubscribe()
      this.spectrumSubscription = undefined
    }
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
    this.unsubscribeFromSpectrum()
    this.stopSpectrumLoop()
    if (this.spectrumIntersectionObserver) {
      this.spectrumIntersectionObserver.disconnect()
      this.spectrumIntersectionObserver = undefined
    }
    this.dettachWindowEvents()
  }
}
