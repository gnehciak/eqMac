import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectorRef
} from '@angular/core'
import { DomSanitizer, SafeUrl } from '@angular/platform-browser'
import { ColorsService } from '@eqmac/components'
import { ApplicationService } from '../../../services/app.service'
import { AppMixerService, MixerApp } from '../app-mixer.service'

@Component({
  selector: 'eqm-app-row',
  templateUrl: './app-row.component.html',
  // No separate .scss file for this sub-component — styles are scoped inline.
  // Colors come from theme CSS custom properties (--eqm-* tokens).
  //
  // Pro-style vertical channel strip: app icon on top (click to mute),
  // tall vertical fader with tick marks and an accent fill below the
  // thumb, percentage box at the bottom.
  styles: [ `
    :host {
      display: block;
    }
    .app-strip {
      height: 100%;
      padding: 6px 4px;
      box-sizing: border-box;
    }
    .icon-wrap {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .app-strip.disabled .icon-wrap {
      cursor: default;
    }
    img.app-icon {
      width: 24px;
      height: 24px;
      display: block;
    }
    /* Dim the icon when the app is muted */
    .app-strip.muted-state .app-icon {
      opacity: 0.35;
      filter: grayscale(100%);
    }
    .fader {
      position: relative;
      width: 100%;
      min-height: 0;
    }
    /* eqm-fader renders bottom = min natively (no scaleY flip / inverted
       value needed) and draws its own rail, ticks and accent fill. */
    .fader-slider {
      width: 26px;
      height: 100%;
      min-height: 0;
      margin: 0 auto;
      display: block;
    }
    .app-strip.muted-state .fader-slider {
      opacity: 0.5;
    }
    .strip-value {
      flex-shrink: 0;
    }
  ` ]
})
export class AppRowComponent implements OnChanges, OnDestroy {
  @Input() app: MixerApp
  @Input() enabled = true

  volume = 1
  muted = false
  iconSrc?: SafeUrl

  constructor (
    public mixer: AppMixerService,
    public applicationService: ApplicationService,
    public changeRef: ChangeDetectorRef,
    public sanitizer: DomSanitizer,
    public colors: ColorsService
  ) {}

  get name () {
    return (this.app && (this.app.name || this.app.bundleId)) || ''
  }

  get volumePercent () {
    return Math.round(this.clampVolume(this.volume) * 100)
  }

  // The system / "other audio" strip renders a speaker glyph instead of a
  // bundle icon (matching the Pro reference).
  private static readonly SYSTEM_BUNDLE_IDS = [
    'system',
    'other',
    'com.apple.systemsounds',
    'com.apple.audio.SystemSoundServer'
  ]

  get isSystem () {
    const bundleId = ((this.app && this.app.bundleId) || '').toLowerCase()
    return AppRowComponent.SYSTEM_BUNDLE_IDS.indexOf(bundleId) >= 0
  }

  // Height of the accent fill under the thumb. The fader travel region is
  // the strip height minus 14px (2 x 2px slider host padding + 2 x 5px
  // thumb radius); stop 5px short of the thumb center so the fill ends
  // under the thumb edge. calc() clamps negative results to 0.
  get fillHeight () {
    return `calc((100% - 14px) * ${this.clampVolume(this.volume)} - 5px)`
  }

  ngOnChanges (changes: SimpleChanges) {
    if (changes.app) {
      const previous: MixerApp = changes.app.previousValue
      const current: MixerApp = changes.app.currentValue
      if (current && (!previous || previous.bundleId !== current.bundleId)) {
        this.fetchIcon()
      }
      this.syncFromApp()
    }
  }

  // Echo-suppression (booster.component.ts pattern): while the user is dragging
  // ignore inbound state updates for this row so the thumb doesn't fight pushes.
  public ignoreUpdates = false
  public ignoreUpdatesDebouncer: NodeJS.Timer

  private syncFromApp () {
    if (!this.app || this.ignoreUpdates) return
    if (typeof this.app.volume === 'number') {
      this.volume = this.clampVolume(this.app.volume)
    }
    this.muted = !!this.app.muted
  }

  private clampVolume (volume: number) {
    if (volume < 0) return 0
    if (volume > 1) return 1
    return volume
  }

  private suppressEchoes () {
    this.ignoreUpdates = true
    if (this.ignoreUpdatesDebouncer) clearTimeout(this.ignoreUpdatesDebouncer)
    this.ignoreUpdatesDebouncer = setTimeout(() => {
      this.ignoreUpdates = false
      this.syncFromApp()
      this.detectChanges()
    }, 1000)
  }

  setVolume (volume: number) {
    this.volume = this.clampVolume(volume)
    if (this.app) this.app.volume = this.volume
    this.suppressEchoes()
    this.schedulePost()
    this.detectChanges()
  }

  toggleMute () {
    if (!this.enabled) return
    this.muted = !this.muted
    if (this.app) this.app.muted = this.muted
    this.suppressEchoes()
    this.postVolume()
    this.detectChanges()
  }

  // Throttle drag streams to ~20Hz before crossing the bridge —
  // native persists every POST, so don't flood it with every mousemove.
  private static readonly POST_INTERVAL_MS = 50
  private lastPostTime = 0
  private pendingPostTimer?: NodeJS.Timer

  private schedulePost () {
    const elapsed = Date.now() - this.lastPostTime
    if (elapsed >= AppRowComponent.POST_INTERVAL_MS) {
      this.postVolume()
    } else if (!this.pendingPostTimer) {
      this.pendingPostTimer = setTimeout(() => {
        this.pendingPostTimer = undefined
        this.postVolume()
      }, AppRowComponent.POST_INTERVAL_MS - elapsed)
    }
  }

  private postVolume () {
    if (!this.app || !this.app.bundleId) return
    this.lastPostTime = Date.now()
    this.mixer.setVolume({
      bundleId: this.app.bundleId,
      volume: this.volume,
      muted: this.muted
    })
  }

  private static readonly iconCache = new Map<string, SafeUrl>()

  async fetchIcon () {
    const bundleId = this.app && this.app.bundleId
    if (!bundleId) return
    const cached = AppRowComponent.iconCache.get(bundleId)
    if (cached) {
      this.iconSrc = cached
      return
    }
    try {
      let base64 = await this.applicationService.getBundleIcon(bundleId)
      if (!base64) return
      base64 = base64.replace(/\s/g, '')
      // Native returns a full data URL ("data:image/png;base64,...") — but be
      // tolerant of a bare base64 payload too.
      const url = base64.indexOf('data:') === 0 ? base64 : `data:image/png;base64,${base64}`
      const safeUrl = this.sanitizer.bypassSecurityTrustUrl(url)
      AppRowComponent.iconCache.set(bundleId, safeUrl)
      if (!this.destroyed && this.app && this.app.bundleId === bundleId) {
        this.iconSrc = safeUrl
        this.detectChanges()
      }
    } catch (err) {
      // Icon is cosmetic — a fallback glyph is rendered instead
    }
  }

  private destroyed = false
  private detectChanges () {
    if (!this.destroyed) {
      this.changeRef.detectChanges()
    }
  }

  ngOnDestroy () {
    this.destroyed = true
    if (this.pendingPostTimer) {
      // Flush the trailing value so the final slider position always lands
      clearTimeout(this.pendingPostTimer)
      this.pendingPostTimer = undefined
      this.postVolume()
    }
    if (this.ignoreUpdatesDebouncer) clearTimeout(this.ignoreUpdatesDebouncer)
  }
}
