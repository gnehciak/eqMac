import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  HostBinding,
  HostListener,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core'
import { Subscription } from 'rxjs'
import { UtilitiesService } from '../../services/utilities.service'
import { ColorsService } from '../../services/colors.service'
import { FlatSliderValueChangedEvent } from '../flat-slider/flat-slider.component'

export type FaderOrientation = 'vertical' | 'horizontal'

/**
 * The event shape is intentionally identical to the flat-slider's, so a caller
 * can swap `<eqm-flat-slider>` for `<eqm-fader>` and keep the same
 * `(userChangedValue)` handler without touching its type.
 */
export type FaderValueChangedEvent = FlatSliderValueChangedEvent

/**
 * eqm-fader — a real mixing-console fader.
 *
 * Drop-in replacement for `<eqm-flat-slider>` in the vertical channel-strip
 * positions (band gains, app mixer, master volume, delay). Unlike flat-slider,
 * VERTICAL orientation renders bottom = min, top = max and its drag math agrees
 * with that, so callers no longer need the `transform: scaleY(-1)` hack that
 * flips flat-slider's inverted vertical behaviour.
 *
 * All colours come from the --eqm-* theme tokens (directly or via ColorsService)
 * so it re-themes with the rest of the app; the only literal colours are neutral
 * lighting overlays (rgba white/black) and drop shadows, which carry no palette.
 */
@Component({
  selector: 'eqm-fader',
  templateUrl: './fader.component.html',
  styleUrls: [ './fader.component.scss' ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FaderComponent implements OnInit, AfterViewInit, OnDestroy {
  constructor (
    public utils: UtilitiesService,
    public elem: ElementRef<HTMLElement>,
    public colors: ColorsService,
    private readonly changeRef: ChangeDetectorRef
  ) {}

  @Input() min = 0
  @Input() max = 1
  @Input() orientation: FaderOrientation = 'vertical'
  @Input() showTicks = true

  /** Increment for wheel + keyboard. When unset, derived as (max - min) / 100. */
  @Input() step?: number
  /** Number of tick marks along the rail. When unset, derived from the range. */
  @Input() tickCount?: number

  @Output() valueChange = new EventEmitter<number>()
  @Output() userChangedValue = new EventEmitter<FaderValueChangedEvent>()

  @ViewChild('track', { static: true }) trackRef!: ElementRef<HTMLElement>

  /**
   * Half of the thumb's extent along the travel axis. The travel region is
   * inset by this amount at each end so the thumb never overflows the rail, and
   * both the drag math (TS) and the thumb/fill geometry (SCSS) read it from the
   * same source (bound to --eqm-fader-pad on the track element).
   */
  public readonly thumbPadding = 6

  // ----- value -------------------------------------------------------------
  public _value = 0
  @Input()
  set value (newValue: number) {
    const clamped = this.clampValue(typeof newValue === 'number' ? newValue : this._value)
    this._value = clamped
    this.valueChange.emit(this._value)
    this.requestRender()
  }

  get value () { return this._value }

  // ----- disabled ----------------------------------------------------------
  public _disabled = false
  @Input()
  @HostBinding('class.disabled')
  set disabled (value: boolean) {
    this._disabled = value
    this.requestRender()
  }

  get disabled () { return this._disabled }

  // ----- colour ------------------------------------------------------------
  // When left unset, the fill falls back to var(--eqm-accent) in the SCSS, which
  // stays live with the theme. A caller may override with any css colour string.
  private _color?: string
  @Input()
  set color (value: string) { this._color = value }
  get color () { return this._color ?? ColorsService.accent }

  /** null keeps the SCSS var(--eqm-accent) fallback for the default accent fill. */
  get fillVar (): string | null { return this._color ?? null }

  // ----- host a11y bindings ------------------------------------------------
  @HostBinding('attr.role') readonly role = 'slider'
  @HostBinding('class.vertical') get isVertical () { return this.orientation === 'vertical' }
  @HostBinding('class.horizontal') get isHorizontal () { return this.orientation === 'horizontal' }
  @HostBinding('attr.tabindex') get tabindex () { return this.disabled ? -1 : 0 }
  @HostBinding('attr.aria-orientation') get ariaOrientation () { return this.orientation }
  @HostBinding('attr.aria-valuemin') get ariaMin () { return this.min }
  @HostBinding('attr.aria-valuemax') get ariaMax () { return this.max }
  @HostBinding('attr.aria-valuenow') get ariaNow () { return Math.round(this._value * 1e4) / 1e4 }
  @HostBinding('attr.aria-disabled') get ariaDisabled () { return this.disabled ? 'true' : null }

  // ----- render helpers (consumed by the template) -------------------------
  get thumbPaddingPx () { return `${this.thumbPadding}px` }

  /** 0..1 progress from min (bottom / left) to max (top / right). */
  get progress () {
    const range = this.max - this.min
    if (range <= 0) return 0
    const p = (this._value - this.min) / range
    return p < 0 ? 0 : p > 1 ? 1 : p
  }

  get resolvedStep () {
    if (typeof this.step === 'number' && this.step > 0) return this.step
    const range = this.max - this.min
    return range > 0 ? range / 100 : 0.01
  }

  get resolvedTickCount () {
    if (typeof this.tickCount === 'number' && this.tickCount > 0) return Math.round(this.tickCount)
    const steps = (this.max - this.min) / this.resolvedStep
    if (isFinite(steps) && steps >= 4 && steps <= 30) return Math.round(steps)
    return 15
  }

  /** Even tick marks along the rail as a repeating gradient (matches the mock). */
  get ticksBackground () {
    const dir = this.orientation === 'vertical' ? 'to top' : 'to right'
    const n = this.resolvedTickCount
    const line = 'var(--eqm-card-border)'
    return `repeating-linear-gradient(${dir}, ` +
      `transparent 0, transparent calc(100% / ${n} - 1px), ` +
      `${line} calc(100% / ${n} - 1px), ${line} calc(100% / ${n}))`
  }

  // ----- lifecycle ---------------------------------------------------------
  private viewReady = false
  private destroyed = false
  private themeSub?: Subscription

  ngOnInit () {
    // Re-read theme-derived colours (e.g. the default accent fill / aria) when
    // the ThemeService re-stamps the tokens, mirroring ColorsService guidance.
    this.themeSub = this.colors.themeChanged.subscribe(() => this.requestRender())
  }

  ngAfterViewInit () {
    this.viewReady = true
  }

  ngOnDestroy () {
    this.destroyed = true
    this.dettachWindowEvents()
    this.themeSub?.unsubscribe()
  }

  private requestRender () {
    if (this.destroyed) return
    if (this.viewReady) this.changeRef.detectChanges()
    else this.changeRef.markForCheck()
  }

  public clampValue (value: number) {
    if (value < this.min) return this.min
    if (value > this.max) return this.max
    return value
  }

  private roundToPrecision (value: number) {
    return Math.round(value * 1e6) / 1e6
  }

  // ----- pointer -> value --------------------------------------------------
  private valueFromEvent (event: MouseEvent): number {
    const el = this.trackRef.nativeElement
    const coords = this.utils.getCoordinatesInsideElementFromEvent(event, el)
    const pad = this.thumbPadding
    if (this.orientation === 'vertical') {
      const length = el.offsetHeight
      const lo = pad
      const hi = length - pad
      if (hi <= lo) return this._value
      let pos = coords.y
      if (pos < lo) pos = lo
      if (pos > hi) pos = hi
      // top of the rail (pos === lo) is max, bottom (pos === hi) is min
      return this.utils.mapValue(pos, lo, hi, this.max, this.min)
    } else {
      const length = el.offsetWidth
      const lo = pad
      const hi = length - pad
      if (hi <= lo) return this._value
      let pos = coords.x
      if (pos < lo) pos = lo
      if (pos > hi) pos = hi
      // left of the rail (pos === lo) is min, right (pos === hi) is max
      return this.utils.mapValue(pos, lo, hi, this.min, this.max)
    }
  }

  private emitUserChange () {
    this.userChangedValue.emit({ value: this._value })
  }

  // ----- drag lifecycle (mirrors flat-slider) ------------------------------
  public dragging = false

  @HostListener('mousedown', [ '$event' ])
  mousedown (event: MouseEvent) {
    if (this.disabled) return
    this.dragging = true
    this.elem.nativeElement.focus()
    this.value = this.valueFromEvent(event)
    this.emitUserChange()
    event.preventDefault()
  }

  @HostListener('mousemove', [ '$event' ])
  mousemove = (event: MouseEvent) => {
    if (this.disabled || !this.dragging) return
    this.value = this.valueFromEvent(event)
    this.emitUserChange()
  }

  @HostListener('mouseup', [ '$event' ])
  mouseup = (_event: MouseEvent) => {
    this.dragging = false
    this.dettachWindowEvents()
  }

  @HostListener('mouseleave')
  mouseleave () {
    // Keep tracking the pointer once it leaves the element mid-drag.
    if (this.dragging) this.attachWindowEvents()
  }

  @HostListener('mouseenter')
  mouseenter () {
    if (this.windowEventsAttached) this.dettachWindowEvents()
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

  // ----- wheel -------------------------------------------------------------
  private lastWheelEvent = 0
  @HostListener('wheel', [ '$event' ])
  onWheel (event: WheelEvent) {
    if (this.disabled) return
    const now = Date.now()
    if (now - this.lastWheelEvent < 16) return
    this.lastWheelEvent = now

    const raw = this.orientation === 'horizontal' && event.deltaX !== 0
      ? -event.deltaX
      : -event.deltaY
    if (raw === 0) return
    const direction = raw > 0 ? 1 : -1
    this.value = this.roundToPrecision(this._value + direction * this.resolvedStep)
    this.emitUserChange()
    event.preventDefault()
  }

  // ----- keyboard ----------------------------------------------------------
  @HostListener('keydown', [ '$event' ])
  onKeydown (event: KeyboardEvent) {
    if (this.disabled) return
    const coarse = event.shiftKey ? 5 : 1
    const stepAmount = this.resolvedStep * coarse
    let handled = true
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        this.value = this.roundToPrecision(this._value + stepAmount)
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        this.value = this.roundToPrecision(this._value - stepAmount)
        break
      case 'Home':
        this.value = this.min
        break
      case 'End':
        this.value = this.max
        break
      default:
        handled = false
    }
    if (handled) {
      this.emitUserChange()
      event.preventDefault()
    }
  }
}
