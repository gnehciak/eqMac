import { Pipe, PipeTransform } from '@angular/core'
import { TranslateService, TranslationParams } from '../services/translate.service'

/**
 * Usage: {{ 'settings.launchOnLogin' | translate }}
 *        {{ 'help.appVersion' | translate: { version: info.version } }}
 *
 * The pipe is impure so bindings refresh when the user switches language,
 * but each call is just three comparisons unless the key, the params object
 * reference or the service's changeEpoch actually changed — cheap enough for
 * Angular 12 change detection.
 */
@Pipe({
  name: 'translate',
  pure: false
})
export class TranslatePipe implements PipeTransform {
  private lastKey?: string
  private lastParams?: TranslationParams
  private lastEpoch = -1
  private lastValue = ''

  constructor (private readonly translate: TranslateService) {}

  transform (key: string, params?: TranslationParams): string {
    if (
      key === this.lastKey &&
      params === this.lastParams &&
      this.translate.changeEpoch === this.lastEpoch
    ) {
      return this.lastValue
    }
    this.lastKey = key
    this.lastParams = params
    this.lastEpoch = this.translate.changeEpoch
    this.lastValue = this.translate.instant(key, params)
    return this.lastValue
  }
}
