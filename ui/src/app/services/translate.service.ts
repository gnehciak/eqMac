import { Injectable } from '@angular/core'
import { Subject } from 'rxjs'
import { UIService, UISettings } from './ui.service'
import en from '../../assets/i18n/en.json'

// Locale catalogs are flat maps of dot-notation keys -> strings,
// stored in ui/src/assets/i18n/<locale>.json
export interface TranslationMap {
  [key: string]: string
}

export interface TranslationParams {
  [param: string]: string | number
}

export interface Locale {
  id: string
  // Language name in its own language — intentionally not translated
  name: string
}

// UISettings key this service persists inside the existing opaque JSON blob
export interface LocaleUISettings extends UISettings {
  locale?: string
}

const EN_TRANSLATIONS: TranslationMap = en

/**
 * Minimal i18n service (Angular is pinned at 12, so no external framework).
 *
 * - English ships statically imported, so instant() is synchronous and always
 *   has a complete catalog to fall back onto (missing key -> en -> the key).
 * - Other locales load from assets/i18n/<locale>.json at runtime and are
 *   applied atomically: changeEpoch is bumped and localeChanged emits, which
 *   the 'translate' pipe and Options-array builders listen to.
 * - Locale resolution: UISettings.locale override, else navigator.language.
 */
@Injectable({
  providedIn: 'root'
})
export class TranslateService {
  readonly fallbackLocale = 'en'

  readonly availableLocales: Locale[] = [
    { id: 'en', name: 'English' },
    { id: 'de', name: 'Deutsch' },
    { id: 'fr', name: 'Français' },
    { id: 'zh-Hans', name: '简体中文' }
  ]

  // Emits the new locale id after its catalog has been loaded and applied
  localeChanged = new Subject<string>()

  // Monotonic counter bumped on every locale switch — lets the impure
  // 'translate' pipe detect changes with a single number comparison.
  changeEpoch = 0

  locale = this.fallbackLocale

  // Resolves once the initial locale restore (UISettings / navigator) is done
  readonly ready: Promise<void>

  private readonly translations: { [locale: string]: TranslationMap } = {
    en: EN_TRANSLATIONS
  }

  constructor (private readonly ui: UIService) {
    this.ready = this.init()
  }

  /**
   * Synchronous translation lookup: current locale -> en -> the key itself.
   * Supports {param} interpolation, e.g.
   *   instant('help.appVersion', { version: '1.2.3' })
   */
  instant (key: string, params?: TranslationParams): string {
    const catalog = this.translations[this.locale]
    let value = (catalog ? catalog[key] : undefined) ?? EN_TRANSLATIONS[key] ?? key
    if (params) {
      value = value.replace(/\{(\w+)\}/g, (match, param) => {
        const replacement = params[param]
        return typeof replacement === 'undefined' ? match : `${replacement}`
      })
    }
    return value
  }

  has (key: string): boolean {
    const catalog = this.translations[this.locale]
    return (catalog && key in catalog) || key in EN_TRANSLATIONS
  }

  /**
   * User-facing locale switch: loads the catalog, applies it and persists the
   * choice into the UISettings blob. Returns true if the locale was applied.
   */
  async setLocale (locale: string): Promise<boolean> {
    const applied = await this.use(locale)
    if (applied) {
      this.persist({ locale: this.locale })
    }
    return applied
  }

  /**
   * Loads and applies a locale without persisting it.
   */
  async use (locale: string): Promise<boolean> {
    const normalized = this.normalizeLocale(locale)
    const loaded = await this.load(normalized)
    if (!loaded) return false
    if (normalized !== this.locale) {
      this.locale = normalized
      this.changeEpoch++
      this.localeChanged.next(normalized)
    }
    return true
  }

  /**
   * Maps raw identifiers ('de-DE', 'zh-CN', ...) onto an available locale id,
   * falling back to en.
   */
  normalizeLocale (raw?: string): string {
    if (!raw) return this.fallbackLocale
    const lower = raw.toLowerCase()
    if (lower.startsWith('zh')) return 'zh-Hans'
    const exact = this.availableLocales.find(locale => locale.id.toLowerCase() === lower)
    if (exact) return exact.id
    const prefix = lower.split('-')[0]
    const match = this.availableLocales.find(locale => locale.id.toLowerCase() === prefix)
    return match ? match.id : this.fallbackLocale
  }

  private async init () {
    try {
      const settings = await this.ui.getSettings() as LocaleUISettings
      const override = typeof settings.locale === 'string' ? settings.locale : undefined
      const detected = typeof navigator !== 'undefined' ? navigator.language : undefined
      const locale = this.normalizeLocale(override ?? detected)
      if (locale !== this.locale) {
        await this.use(locale)
      }
    } catch (err) {
      // Stay on English if settings could not be fetched
    }
  }

  private async load (locale: string): Promise<boolean> {
    if (this.translations[locale]) return true
    try {
      const response = await fetch(`assets/i18n/${locale}.json`)
      if (!response.ok) return false
      const catalog = await response.json()
      if (!catalog || typeof catalog !== 'object') return false
      this.translations[locale] = catalog
      return true
    } catch (err) {
      // Catalog missing or fetch unavailable (e.g. file:// restrictions)
      return false
    }
  }

  private persist (patch: Partial<LocaleUISettings>) {
    this.ui.setSettings(patch).catch(() => {})
  }
}
