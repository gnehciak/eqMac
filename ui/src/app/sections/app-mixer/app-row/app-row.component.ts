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
  // Colors come from theme CSS custom properties (w1-theme-i18n-core tokens).
  styles: [ `
    :host {
      display: block;
    }
    .app-row {
      height: 100%;
      padding: 0 4px;
      box-sizing: border-box;
    }
    .app-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .app-name {
      width: 90px;
      flex-shrink: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'SF Pro Text';
      font-size: 12px;
      color: var(--eqm-text-light, #c9cdd0);
      cursor: default;
    }
    .slider-container {
      min-width: 0;
    }
    .mute-button {
      flex-shrink: 0;
      cursor: pointer;
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
