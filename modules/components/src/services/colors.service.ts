import { Injectable } from '@angular/core'
import { Subject } from 'rxjs'

/**
 * Themeable color access for code that draws programmatically
 * (canvas / SVG in knob, flat-slider, skeuomorph-slider, icons, ...).
 *
 * Every color is a live getter reading the corresponding CSS custom property
 * (--eqm-* theme token, see ../styles/theme-tokens.scss) from the document
 * root, falling back to the original hardcoded palette when the token is not
 * defined (e.g. theme engine not booted, tests, SSR).
 *
 * The ThemeService (ui app) pushes on `ColorsService.themeChanged` after
 * re-stamping the tokens so widgets that captured a color can redraw.
 */
@Injectable({
  providedIn: 'root'
})
export class ColorsService {
  // Original hardcoded palette (Classic Dark), kept as fallbacks.
  static readonly defaults = {
    accent: '#4f8d71',
    accentLight: '#4DAD82',
    warning: '#eb3f42',
    caution: '#FFD500',
    gradientStart: '#5a5b5f',
    gradientEnd: '#2c2c2e',
    iconGradientStart: '#05FF71',
    iconGradientMiddle: '#03F193',
    iconGradientEnd: '#04E2B5',
    light: '#c9cdd0',
    dark: '#16191c',
    surface: '#16191c'
  }

  // Emits whenever the theme tokens have been re-stamped (fired by the
  // ThemeService). Keep a subscription and redraw canvas/SVG on it.
  static readonly themeChanged = new Subject<void>()
  readonly themeChanged = ColorsService.themeChanged

  private static token (token: string, fallback: string): string {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return fallback
    }
    try {
      const value = window.getComputedStyle(document.documentElement).getPropertyValue(token)
      const trimmed = typeof value === 'string' ? value.trim() : ''
      return trimmed.length > 0 ? trimmed : fallback
    } catch (err) {
      return fallback
    }
  }

  static get accent () { return ColorsService.token('--eqm-accent', ColorsService.defaults.accent) }
  static get accentLight () { return ColorsService.token('--eqm-accent-light', ColorsService.defaults.accentLight) }
  static get warning () { return ColorsService.token('--eqm-warning', ColorsService.defaults.warning) }
  static get caution () { return ColorsService.token('--eqm-caution', ColorsService.defaults.caution) }
  static get gradientStart () { return ColorsService.token('--eqm-gradient-start', ColorsService.defaults.gradientStart) }
  static get gradientEnd () { return ColorsService.token('--eqm-gradient-end', ColorsService.defaults.gradientEnd) }
  static get iconGradientStart () { return ColorsService.token('--eqm-icon-gradient-start', ColorsService.defaults.iconGradientStart) }
  static get iconGradientMiddle () { return ColorsService.token('--eqm-icon-gradient-middle', ColorsService.defaults.iconGradientMiddle) }
  static get iconGradientEnd () { return ColorsService.token('--eqm-icon-gradient-end', ColorsService.defaults.iconGradientEnd) }
  static get light () { return ColorsService.token('--eqm-text-light', ColorsService.defaults.light) }
  static get dark () { return ColorsService.token('--eqm-text-dark', ColorsService.defaults.dark) }
  static get surface () { return ColorsService.token('--eqm-surface', ColorsService.defaults.surface) }

  get accent () { return ColorsService.accent }
  get accentLight () { return ColorsService.accentLight }
  get warning () { return ColorsService.warning }
  get caution () { return ColorsService.caution }
  get gradientStart () { return ColorsService.gradientStart }
  get gradientEnd () { return ColorsService.gradientEnd }
  get iconGradientStart () { return ColorsService.iconGradientStart }
  get iconGradientMiddle () { return ColorsService.iconGradientMiddle }
  get iconGradientEnd () { return ColorsService.iconGradientEnd }
  get light () { return ColorsService.light }
  get dark () { return ColorsService.dark }
  get surface () { return ColorsService.surface }
}
