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

/**
 * Canvas spectrum analyzer.
 *
 * Renders FFT magnitude frames (~64 log-spaced bins, 20Hz-20kHz) pushed via
 * the `frames` Input observable. Bins are assumed to be log-spaced over the
 * same frequency axis eqm-eq-graph uses, so equal-width bars line up with the
 * graph's log-x axis and the component can underlay it (pointer-events are
 * disabled so the graph above stays interactive).
 *
 * Does zero work when there is no subscription, no recent frames or the
 * canvas is not visible: the requestAnimationFrame loop only runs while
 * there is something to animate.
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

  /** Magnitude of the quietest expected frame value (dB floor) */
  @Input() minValue = -90
  /** Magnitude of the loudest expected frame value */
  @Input() maxValue = 0
  /** Normalized units (0..1) the bars fall per second when the signal drops */
  @Input() decayPerSecond = 1.5
  @Input() peakHold = true
  /** How long a peak marker holds before it starts falling, in ms */
  @Input() peakHoldMs = 1000
  /** Normalized units (0..1) the peak markers fall per second after the hold */
  @Input() peakDecayPerSecond = 0.4
  /** Gap between bars in CSS pixels */
  @Input() barGap = 1

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
  private running = false
  private visible = true
  private lastFrameAt = 0
  private lastTickAt = 0
  private readonly idleTimeoutMs = 2000

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
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private stopLoop () {
    this.running = false
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = undefined
    }
  }

  private readonly tick = (now: number) => {
    this.animationFrame = undefined
    if (!this.running) return

    const dt = Math.min((now - this.lastTickAt) / 1000, 0.1)
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

    const idle = (now - this.lastFrameAt) > this.idleTimeoutMs && energy < 0.001
    if (idle) {
      // Nothing left to animate — park the loop until the next frame arrives
      this.running = false
      return
    }
    this.animationFrame = requestAnimationFrame(this.tick)
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

    // Bins are log-spaced over 20Hz-20kHz, matching the eq-graph x axis,
    // so each bin maps to an equal-width column.
    const barWidth = width / binCount
    const gap = Math.min(this.barGap, barWidth / 2)

    // Colors are read from ColorsService at draw time so a live theme
    // change is picked up on the next animation frame.
    const barColor = this.rgbaFromHex(this.colors.accent, 0.35)
    const peakColor = this.rgbaFromHex(this.colors.accentLight, 0.7)

    context.fillStyle = barColor
    for (let i = 0; i < binCount; i++) {
      const barHeight = this.displayed[i] * height
      if (barHeight <= 0) continue
      context.fillRect(i * barWidth, height - barHeight, barWidth - gap, barHeight)
    }

    if (this.peakHold) {
      context.fillStyle = peakColor
      for (let i = 0; i < binCount; i++) {
        const peak = this.peaks[i]
        if (peak <= 0.001) continue
        const y = height - peak * height
        context.fillRect(i * barWidth, y, barWidth - gap, 1.5)
      }
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
