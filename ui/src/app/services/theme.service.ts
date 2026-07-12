import { Injectable } from '@angular/core'
import { Subject } from 'rxjs'
import { ColorsService } from '@eqmac/components'
import { UIService, UISettings } from './ui.service'

export interface ThemeTokens {
  [customProperty: string]: string
}

export interface Theme {
  id: string
  // Plain-English name (fallback) + translate key for the picker UI
  name: string
  nameKey: string
  tokens: ThemeTokens
}

// UISettings keys this service persists inside the existing opaque JSON blob
// (native side merges partial POSTs — zero native change needed).
// null clears a previously persisted custom accent.
export interface ThemeUISettings extends UISettings {
  theme?: string
  customAccent?: string | null
}

// Classic Dark — the original hardcoded eqMac palette. Must stay in sync with
// modules/components/src/styles/theme-tokens.scss
// Keep in sync with the defaults in modules/components/src/styles/theme-tokens.scss
// - this map is stamped onto :root at startup and wins over the stylesheet.
export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  '--eqm-accent': '#3fca87',
  '--eqm-accent-light': '#5fd39b',
  '--eqm-warning': '#eb3f42',
  '--eqm-caution': '#FFD500',
  '--eqm-gradient-start': '#4a4c50',
  '--eqm-gradient-end': '#1c1e20',
  '--eqm-icon-gradient-start': '#05FF71',
  '--eqm-icon-gradient-middle': '#03F193',
  '--eqm-icon-gradient-end': '#04E2B5',
  '--eqm-text-light': '#c9cdd0',
  '--eqm-text-medium': '#1e1e1e',
  '--eqm-text-dark': '#16191c',
  '--eqm-surface': '#16191c',
  '--eqm-card-surface': '#26282b',
  '--eqm-card-border': '#34373b',
  '--eqm-band-strip-bg': '#202225'
}

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly themes: Theme[] = [
    {
      id: 'classic-dark',
      name: 'Classic Dark',
      nameKey: 'themes.classicDark',
      tokens: {}
    },
    {
      id: 'light',
      name: 'Light',
      nameKey: 'themes.light',
      tokens: {
        '--eqm-accent': '#3d8266',
        '--eqm-accent-light': '#4f9d7c',
        '--eqm-warning': '#d63438',
        '--eqm-caution': '#9c7d00',
        '--eqm-gradient-start': '#f4f5f6',
        '--eqm-gradient-end': '#dcdee1',
        '--eqm-text-light': '#26292d',
        '--eqm-text-medium': '#dfe1e4',
        '--eqm-text-dark': '#eef0f2',
        '--eqm-surface': '#ffffff',
        '--eqm-card-surface': '#e9ebee',
        '--eqm-card-border': '#c8ccd1',
        '--eqm-band-strip-bg': '#dfe2e6'
      }
    },
    {
      id: 'ocean-blue',
      name: 'Ocean Blue',
      nameKey: 'themes.oceanBlue',
      tokens: {
        '--eqm-accent': '#4a7fb5',
        '--eqm-accent-light': '#5f9bd6'
      }
    },
    {
      id: 'royal-purple',
      name: 'Royal Purple',
      nameKey: 'themes.royalPurple',
      tokens: {
        '--eqm-accent': '#8168c9',
        '--eqm-accent-light': '#997fd9'
      }
    },
    {
      // The original eqMac v1 accent color
      id: 'sunset-orange',
      name: 'Sunset Orange',
      nameKey: 'themes.sunsetOrange',
      tokens: {
        '--eqm-accent': '#de5f00',
        '--eqm-accent-light': '#f07f2a'
      }
    },
    {
      id: 'crimson',
      name: 'Crimson',
      nameKey: 'themes.crimson',
      tokens: {
        '--eqm-accent': '#c04a4d',
        '--eqm-accent-light': '#d66b6e'
      }
    },
    {
      id: 'gold',
      name: 'Gold',
      nameKey: 'themes.gold',
      tokens: {
        '--eqm-accent': '#b8952f',
        '--eqm-accent-light': '#d2ae4a'
      }
    }
  ]

  // Emits the applied theme after tokens have been stamped
  themeChanged = new Subject<Theme>()

  currentTheme: Theme
  customAccent?: string

  constructor (private readonly ui: UIService) {
    // Stamp the default theme synchronously so derived tokens exist from the
    // first paint, then restore the persisted selection.
    this.currentTheme = this.defaultTheme
    this.applyTheme(this.defaultTheme, { persist: false })
    this.restore()
  }

  get defaultTheme () {
    return this.themes[0]
  }

  getTheme (id: string) {
    return this.themes.find(theme => theme.id === id)
  }

  /**
   * Full token map for a theme: defaults, overridden by the theme's own
   * tokens, plus the recomputed derived tokens. Useful for rendering theme
   * preview swatches without applying the theme.
   */
  resolveTokens (theme: Theme): ThemeTokens {
    const base: ThemeTokens = { ...DEFAULT_THEME_TOKENS, ...theme.tokens }
    return { ...base, ...this.derivedTokens(base) }
  }

  applyTheme (themeOrId: Theme | string, { persist }: { persist?: boolean } = {}) {
    const theme = (typeof themeOrId === 'string' ? this.getTheme(themeOrId) : themeOrId) ?? this.defaultTheme
    this.customAccent = undefined
    this.stamp(this.resolveTokens(theme))
    this.currentTheme = theme
    this.notifyChanged()
    if (persist !== false) {
      this.persist({ theme: theme.id, customAccent: null })
    }
  }

  /**
   * Overrides the accent (+ derived accent tokens) of the current theme with
   * a custom color. Pass a hex color like '#de5f00'.
   */
  setCustomAccent (accent: string, { persist }: { persist?: boolean } = {}) {
    this.customAccent = accent
    this.stamp({
      '--eqm-accent': accent,
      '--eqm-accent-light': this.shiftLightness(accent, 8),
      '--eqm-accent-darken-20': this.shiftLightness(accent, -20),
      '--eqm-accent-rgba-50': this.alpha(accent, 0.5)
    })
    this.notifyChanged()
    if (persist !== false) {
      this.persist({ customAccent: accent })
    }
  }

  private async restore () {
    try {
      const settings = await this.ui.getSettings() as ThemeUISettings
      const theme = typeof settings.theme === 'string' ? this.getTheme(settings.theme) : undefined
      if (theme && theme.id !== this.currentTheme.id) {
        this.applyTheme(theme, { persist: false })
      }
      if (typeof settings.customAccent === 'string' && settings.customAccent.length > 0) {
        this.setCustomAccent(settings.customAccent, { persist: false })
      }
    } catch (err) {
      // Keep the default theme if settings could not be fetched
    }
  }

  private stamp (tokens: ThemeTokens) {
    if (typeof document === 'undefined') return
    const style = document.documentElement.style
    for (const token of Object.keys(tokens)) {
      style.setProperty(token, tokens[token])
    }
  }

  private notifyChanged () {
    this.themeChanged.next(this.currentTheme)
    ColorsService.themeChanged.next()
  }

  private persist (patch: Partial<ThemeUISettings>) {
    this.ui.setSettings(patch).catch(() => {})
  }

  private derivedTokens (tokens: ThemeTokens): ThemeTokens {
    return {
      '--eqm-accent-darken-20': this.shiftLightness(tokens['--eqm-accent'], -20),
      '--eqm-accent-rgba-50': this.alpha(tokens['--eqm-accent'], 0.5),
      '--eqm-gradient-start-darken-6': this.shiftLightness(tokens['--eqm-gradient-start'], -6),
      '--eqm-gradient-end-lighten-3': this.shiftLightness(tokens['--eqm-gradient-end'], 3)
    }
  }

  // --- Color math (mirrors Sass darken/lighten semantics: +- HSL lightness) ---

  private hexToRgb (hex: string): { r: number, g: number, b: number } {
    let value = hex.replace('#', '')
    if (value.length === 3) {
      value = value.split('').map(char => char + char).join('')
    }
    const int = parseInt(value, 16)
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255
    }
  }

  private shiftLightness (hex: string, amount: number): string {
    const { h, s, l } = this.rgbToHsl(this.hexToRgb(hex))
    return this.hslToHex(h, s, Math.max(0, Math.min(100, l + amount)))
  }

  private alpha (hex: string, alpha: number): string {
    const { r, g, b } = this.hexToRgb(hex)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  private rgbToHsl ({ r, g, b }: { r: number, g: number, b: number }): { h: number, s: number, l: number } {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    if (max === min) {
      return { h: 0, s: 0, l: l * 100 }
    }
    const delta = max - min
    const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    let h: number
    switch (max) {
      case rn: h = (gn - bn) / delta + (gn < bn ? 6 : 0); break
      case gn: h = (bn - rn) / delta + 2; break
      default: h = (rn - gn) / delta + 4
    }
    return { h: h * 60, s: s * 100, l: l * 100 }
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
}
