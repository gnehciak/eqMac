import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  OnInit,
  OnDestroy,
  HostListener,
  ChangeDetectionStrategy
} from '@angular/core'
import { Observable, Subscription } from 'rxjs'
import { UtilitiesService } from '../../services/utilities.service'
import { ColorsService } from '../../services/colors.service'
import {
  SPECTRUM_FLOOR_DB,
  SPECTRUM_CEIL_DB,
  spectrumBinX
} from '../eq-graph/eq-graph.component'

/**
 * Canvas spectrum analyzer.
 *
 * Renders FFT magnitude frames (~64 log-spaced bins, 20Hz-20kHz) pushed via
 * the `frames` Input observable as a warning-red translucent area (current
 * magnitudes) plus a brighter peak-hold line — the same visual eqm-eq-graph
 * draws for its internal underlay. Bins are log-spaced over the same frequency
 * axis eqm-eq-graph uses (`spectrumBinX`) and share its dBFS scale
 * (SPECTRUM_FLOOR_DB..SPECTRUM_CEIL_DB), so the trace lines up pixel-for-pixel
 * whether it is layered inside the graph or underlaid as a sibling. Pointer
 * events are disabled so the graph above stays interactive.
 *
 * The rAF loop only runs while visible and while there is something to animate;
 * it parks at the floor when the signal drops. Under prefers-reduced-motion it
 * falls back to a 1 fps interval (decay still resolves, just coarsely).
 */
@Component({
  selector: 'eqm-spectrum',
  template: '<canvas #canvas class="spectrum-canvas"></canvas>',
  styleUrls: [ './spectrum.component.scss' ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SpectrumComponent implements OnInit, OnDestroy {
  constructor (
    public utils: UtilitiesService,
    public colors: ColorsService,
    public elem: ElementRef<HTMLElement>
  ) {}

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>

  /** Magnitude of the quietest expected frame value (dBFS floor). Defaults to
   * the shared spectrum scale so a standalone sibling lines up with the graph. */
  @Input() minValue = SPECTRUM_FLOOR_DB
  /** Magnitude of the loudest expected frame value (dBFS ceiling) */
  @Input() maxValue = SPECTRUM_CEIL_DB
  /** Normalized units (0..1) the area falls per second when the signal drops */
  @Input() decayPerSecond = 1.5
  @Input() peakHold = true
  /** How long a peak marker holds before it starts falling, in ms */
  @Input() peakHoldMs = 1000
  /** Normalized units (0..1) the peak line falls per second after the hold */
  @Input() peakDecayPerSecond = 0.4

  private subscription?: Subscription
  private subscribed = false
  private _frames?: Observable<number[]> | null = null
  @Input()
  set frames (observable: Observable<number[]> | null | undefined) {
    this._frames = observable
    this.unsubscribeFromFrames()
    if (observable) {
      // Flag first — some observables (e.g. BehaviorSubject) emit synchronously
      // on subscribe, before the subscription is assigned
      this.subscribed = true
      this.subscription = observable.subscribe(frame => this.onFrame(frame))
    }
  }

  get frames () { return this._frames }

  private targets = new Float32Array(0)
  private displayed = new Float32Array(0)
  private peaks = new Float32Array(0)
  private peakTimestamps = new Float32Array(0)

  private animationFrame?: number
  private intervalId?: ReturnType<typeof setInterval>
  private running = false
  private visible = true
  private lastFrameAt = 0
  private lastTickAt = 0
  private readonly idleTimeoutMs = 2000
  // Resolved at construction (before Angular binds the frames input) so an
  // early binding under reduced motion still takes the 1 fps path
  private reducedMotion = typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  private intersectionObserver?: IntersectionObserver

  ngOnInit () {
    this.resizeCanvas()
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(entries => {
        const entry = entries[entries.length - 1]
        this.visible = !!entry && entry.isIntersecting
        if (this.visible) {
          this.startLoop()
        } else {
          this.stopLoop()
        }
      })
      this.intersectionObserver.observe(this.elem.nativeElement)
    }
  }

  @HostListener('window:resize')
  onWindowResize () {
    this.resizeCanvas()
  }

  private onFrame (frame: number[]) {
    if (!frame || !frame.length) return
    if (this.targets.length !== frame.length) {
      this.targets = new Float32Array(frame.length)
      this.displayed = new Float32Array(frame.length)
      this.peaks = new Float32Array(frame.length)
      this.peakTimestamps = new Float32Array(frame.length)
    }
    const range = (this.maxValue - this.minValue) || 1
    for (let i = 0; i < frame.length; i++) {
      let normalized = (frame[i] - this.minValue) / range
      if (normalized < 0) normalized = 0
      if (normalized > 1) normalized = 1
      this.targets[i] = normalized
    }
    this.lastFrameAt = performance.now()
    this.startLoop()
  }

  private startLoop () {
    if (this.running || !this.visible || !this.subscribed) return
    this.running = true
    this.lastTickAt = performance.now()
    if (this.reducedMotion) {
      // 1 fps fallback — decay still resolves, just coarsely; the interval
      // keeps ticking (cheaply) so the trace sits at the floor rather than
      // vanishing when the signal drops
      this.draw()
      this.intervalId = setInterval(() => this.advance(performance.now()), 1000)
    } else {
      this.animationFrame = requestAnimationFrame(this.tick)
    }
  }

  private stopLoop () {
    this.running = false
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = undefined
    }
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
  }

  private readonly tick = (now: number) => {
    this.animationFrame = undefined
    if (!this.running) return
    const idle = this.advance(now)
    if (idle) {
      // Nothing left to animate — park the loop until the next frame arrives
      this.running = false
      return
    }
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  /** One decay/peak-hold step + redraw. Returns true when idle (at the floor). */
  private advance (now: number): boolean {
    const dt = Math.min((now - this.lastTickAt) / 1000, this.reducedMotion ? 1.1 : 0.1)
    this.lastTickAt = now

    let energy = 0
    const decay = this.decayPerSecond * dt
    const peakDecay = this.peakDecayPerSecond * dt
    for (let i = 0; i < this.displayed.length; i++) {
      const target = this.targets[i]
      const fallen = this.displayed[i] - decay
      this.displayed[i] = target > fallen ? target : (fallen > 0 ? fallen : 0)

      if (this.peakHold) {
        if (this.displayed[i] >= this.peaks[i]) {
          this.peaks[i] = this.displayed[i]
          this.peakTimestamps[i] = now
        } else if (now - this.peakTimestamps[i] > this.peakHoldMs) {
          const peakFallen = this.peaks[i] - peakDecay
          this.peaks[i] = peakFallen > this.displayed[i] ? peakFallen : this.displayed[i]
        }
        energy += this.peaks[i]
      }
      energy += this.displayed[i]
    }

    this.draw()

    return (now - this.lastFrameAt) > this.idleTimeoutMs && energy < 0.001
  }

  private cssWidth = 0
  private cssHeight = 0
  private resizeCanvas () {
    const canvas = this.canvasRef.nativeElement
    const width = this.elem.nativeElement.offsetWidth
    const height = this.elem.nativeElement.offsetHeight
    if (!width || !height) return
    if (width === this.cssWidth && height === this.cssHeight) return
    this.cssWidth = width
    this.cssHeight = height
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d')
    if (context) {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  private rgbaFromHex (hex: string, alpha: number) {
    const { r, g, b } = this.utils.hexToRgb(hex)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  private draw () {
    const canvas = this.canvasRef.nativeElement
    const context = canvas.getContext('2d')
    if (!context) return
    // Element may have been laid out after init — pick up size changes lazily
    if (this.elem.nativeElement.offsetWidth !== this.cssWidth ||
        this.elem.nativeElement.offsetHeight !== this.cssHeight) {
      this.resizeCanvas()
    }
    const width = this.cssWidth
    const height = this.cssHeight
    if (!width || !height) return

    context.clearRect(0, 0, width, height)

    const binCount = this.displayed.length
    if (!binCount) return

    // Colors are read from ColorsService at draw time so a live theme change
    // is picked up on the next frame. Warning-red, matching the graph underlay.
    const areaColor = this.rgbaFromHex(this.colors.warning, 0.16)
    const lineColor = this.rgbaFromHex(this.colors.warning, 0.6)

    // Area under the current magnitudes. Bins are log-spaced over 20Hz-20kHz,
    // so `spectrumBinX` places bin i exactly where eqm-eq-graph's log-x axis
    // puts that frequency.
    context.beginPath()
    context.moveTo(0, height)
    for (let i = 0; i < binCount; i++) {
      context.lineTo(spectrumBinX(i, binCount, width), height * (1 - this.displayed[i]))
    }
    context.lineTo(width, height)
    context.closePath()
    context.fillStyle = areaColor
    context.fill()

    // Brighter peak-hold line
    if (this.peakHold) {
      context.beginPath()
      for (let i = 0; i < binCount; i++) {
        const y = height * (1 - this.peaks[i])
        if (i) context.lineTo(spectrumBinX(i, binCount, width), y)
        else context.moveTo(spectrumBinX(i, binCount, width), y)
      }
      context.strokeStyle = lineColor
      context.lineWidth = 1.2
      context.stroke()
    }
  }

  private unsubscribeFromFrames () {
    this.subscribed = false
    if (this.subscription) {
      this.subscription.unsubscribe()
      this.subscription = undefined
    }
  }

  ngOnDestroy () {
    this.unsubscribeFromFrames()
    this.stopLoop()
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect()
      this.intersectionObserver = undefined
    }
  }
}
