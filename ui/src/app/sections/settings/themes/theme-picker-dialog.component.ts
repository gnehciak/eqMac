import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  Inject,
  Optional
} from '@angular/core'
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog'
import { Subscription } from 'rxjs'
import { FlatSliderValueChangedEvent } from '@eqmac/components'
import { Theme, ThemeService } from '../../../services/theme.service'
import { TranslateService } from '../../../services/translate.service'

export interface ThemePickerDialogData {
  title?: string
}

export interface ThemeCard {
  theme: Theme
  // CSS background for the card itself (theme's window gradient)
  background: string
  // Representative token colors rendered as small swatches
  swatches: string[]
  // Label color that stays legible on top of the card background
  textColor: string
}

// Fixed saturation / lightness the hue slider maps onto.
// Chosen to sit in the same perceptual range as the built-in theme accents.
export const CUSTOM_ACCENT_SATURATION = 45
export const CUSTOM_ACCENT_LIGHTNESS = 48

@Component({
  selector: 'eqm-theme-picker-dialog',
  templateUrl: './theme-picker-dialog.component.html',
  styleUrls: [ './theme-picker-dialog.component.scss' ]
})
export class ThemePickerDialogComponent implements OnInit, OnDestroy {
  title = ''

  cards: ThemeCard[] = []

  // Hue slider state (0 - 360)
  hue = 0
  // Hex color the hue slider currently represents (shown in the swatch and
  // used to tint the slider itself)
  accentPreview = '#4f8d71'

  // Live theme stamping is throttled to ~30Hz (repo rule for drag streams),
  // persistence is debounced so only the final value hits UISettings.
  private static readonly LIVE_APPLY_INTERVAL_MS = 33
  private static readonly PERSIST_DEBOUNCE_MS = 500
  private lastLiveApply = 0
  private liveApplyTimer: any
  private persistTimer: any
  private pendingAccent: string | null = null

  private themeChangedSubscription: Subscription
  private destroyed = false

  constructor (
    public themeService: ThemeService,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef,
    public dialogRef: MatDialogRef<ThemePickerDialogComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data: ThemePickerDialogData
  ) {
    this.title = this.translate.instant('settings.theme')
    if (this.data && this.data.title) {
      this.title = this.data.title
    }
  }

  ngOnInit () {
    this.buildCards()
    this.syncSliderWithCurrentAccent()

    // Re-render highlight / preview if the theme changes from anywhere else
    this.themeChangedSubscription = this.themeService.themeChanged.subscribe(() => {
      this.detectChanges()
    })
  }

  private buildCards () {
    this.cards = this.themeService.themes.map(theme => {
      const tokens = this.themeService.resolveTokens(theme)
      return {
        theme,
        background: `linear-gradient(135deg, ${tokens['--eqm-gradient-start']}, ${tokens['--eqm-gradient-end']})`,
        swatches: [
          tokens['--eqm-accent'],
          tokens['--eqm-accent-light'],
          tokens['--eqm-text-light'],
          tokens['--eqm-surface']
        ],
        textColor: tokens['--eqm-text-light']
      }
    })
  }

  private syncSliderWithCurrentAccent () {
    const accent = this.themeService.customAccent ??
      this.themeService.resolveTokens(this.themeService.currentTheme)['--eqm-accent']
    this.hue = this.hexToHue(accent)
    this.accentPreview = accent
  }

  trackCard (index: number, card: ThemeCard) {
    return card.theme.id
  }

  isCurrent (card: ThemeCard) {
    return this.themeService.currentTheme.id === card.theme.id
  }

  get hasCustomAccent () {
    return typeof this.themeService.customAccent === 'string'
  }

  // MARK: - User actions

  select (card: ThemeCard) {
    this.cancelPendingAccent()
    // Applies instantly and persists { theme, customAccent: null } to UISettings
    this.themeService.applyTheme(card.theme)
    this.syncSliderWithCurrentAccent()
    this.detectChanges()
  }

  onHueChanged (event: FlatSliderValueChangedEvent) {
    this.hue = event.value
    const accent = this.hslToHex(this.hue, CUSTOM_ACCENT_SATURATION, CUSTOM_ACCENT_LIGHTNESS)
    this.accentPreview = accent
    this.pendingAccent = accent
    this.liveApply(accent)
    this.schedulePersist(accent)
    this.detectChanges()
  }

  clearCustomAccent () {
    this.cancelPendingAccent()
    // Re-applying the current theme resets the accent override and
    // persists { theme, customAccent: null }
    this.themeService.applyTheme(this.themeService.currentTheme)
    this.syncSliderWithCurrentAccent()
    this.detectChanges()
  }

  close () {
    this.dialogRef.close()
  }

  // MARK: - Throttled live apply + debounced persist

  private liveApply (accent: string) {
    const elapsed = Date.now() - this.lastLiveApply
    if (this.liveApplyTimer) {
      clearTimeout(this.liveApplyTimer)
      this.liveApplyTimer = undefined
    }
    if (elapsed >= ThemePickerDialogComponent.LIVE_APPLY_INTERVAL_MS) {
      this.lastLiveApply = Date.now()
      this.themeService.setCustomAccent(accent, { persist: false })
    } else {
      this.liveApplyTimer = setTimeout(() => {
        this.liveApplyTimer = undefined
        this.lastLiveApply = Date.now()
        this.themeService.setCustomAccent(accent, { persist: false })
      }, ThemePickerDialogComponent.LIVE_APPLY_INTERVAL_MS - elapsed)
    }
  }

  private schedulePersist (accent: string) {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined
      this.pendingAccent = null
      // Stamps the final value again (idempotent) and persists it
      this.themeService.setCustomAccent(accent)
    }, ThemePickerDialogComponent.PERSIST_DEBOUNCE_MS)
  }

  private cancelPendingAccent () {
    if (this.liveApplyTimer) {
      clearTimeout(this.liveApplyTimer)
      this.liveApplyTimer = undefined
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    this.pendingAccent = null
  }

  // MARK: - Color math (hue slider only - full theme math lives in ThemeService)

  private hexToHue (hex: string): number {
    let value = (hex || '').replace('#', '')
    if (value.length === 3) {
      value = value.split('').map(char => char + char).join('')
    }
    const int = parseInt(value, 16)
    if (isNaN(int)) return 0
    const r = ((int >> 16) & 255) / 255
    const g = ((int >> 8) & 255) / 255
    const b = (int & 255) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max === min) return 0
    const delta = max - min
    let h: number
    switch (max) {
      case r: h = (g - b) / delta + (g < b ? 6 : 0); break
      case g: h = (b - r) / delta + 2; break
      default: h = (r - g) / delta + 4
    }
    return Math.round(h * 60)
  }

  private hslToHex (h: number, s: number, l: number): string {
    const sn = s / 100
    const ln = l / 100
    const chroma = (1 - Math.abs(2 * ln - 1)) * sn
    const hp = ((h % 360) + 360) % 360 / 60
    const x = chroma * (1 - Math.abs((hp % 2) - 1))
    const sector = Math.floor(hp) % 6
    const rgbBySector = [
      [ chroma, x, 0 ],
      [ x, chroma, 0 ],
      [ 0, chroma, x ],
      [ 0, x, chroma ],
      [ x, 0, chroma ],
      [ chroma, 0, x ]
    ]
    const [ rn, gn, bn ] = rgbBySector[sector]
    const m = ln - chroma / 2
    const toHex = (channel: number) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')
    return `#${toHex(rn)}${toHex(gn)}${toHex(bn)}`
  }

  private detectChanges () {
    if (!this.destroyed) {
      this.changeRef.detectChanges()
    }
  }

  ngOnDestroy () {
    this.destroyed = true
    if (this.liveApplyTimer) {
      clearTimeout(this.liveApplyTimer)
      this.liveApplyTimer = undefined
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    // Closing mid-drag: make sure the last picked accent still gets persisted
    if (this.pendingAccent) {
      this.themeService.setCustomAccent(this.pendingAccent)
      this.pendingAccent = null
    }
    if (this.themeChangedSubscription) {
      this.themeChangedSubscription.unsubscribe()
    }
  }
}
