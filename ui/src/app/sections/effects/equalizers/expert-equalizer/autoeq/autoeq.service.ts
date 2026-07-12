import { Injectable } from '@angular/core'
import { ExpertEqualizerService } from '../expert-equalizer.service'

/**
 * One row of a native AutoEQ database search response.
 * `id` is a stringified index into the bundled database — treat it as an
 * opaque token that is only valid against the currently running native app.
 */
export interface AutoEQSearchResult {
  id: string
  name: string
  source: string
  rig: string
}

export interface AutoEQSearchResponse {
  results: AutoEQSearchResult[]
  total: number
}

export interface AutoEQApplyOptions {
  /**
   * true — persist the profile as a brand new user preset (named `name`,
   * falling back to the headphone name) and select it.
   * false / omitted — write the profile into the 'manual' preset and select
   * it (house audition contract).
   */
  saveAsPreset?: boolean
  /** Custom preset name, only meaningful with saveAsPreset: true */
  name?: string
}

/**
 * AutoEQ headphone preset database client.
 *
 * Extends the Expert Equalizer service purely for the house route-shadowing
 * pattern: route resolves to /effects/equalizers/expert/autoeq (the native
 * AutoEQDataBus is mounted inside ExpertEqualizerDataBus).
 */
@Injectable({
  providedIn: 'root'
})
export class AutoEQService extends ExpertEqualizerService {
  route = `${this.route}/autoeq`

  /**
   * Case-insensitive substring search over headphone names.
   * An empty query matches the whole database. Native caps `results` at 200
   * rows; `total` is the uncapped match count. The first call takes a
   * moment — native lazily gunzips + decodes the bundled database.
   */
  search (query: string): Promise<AutoEQSearchResponse> {
    return this.request({ method: 'GET', endpoint: '/search', data: { q: query } })
  }

  /**
   * Applies an AutoEQ profile to the Expert Equalizer.
   * Resolves with the created preset (saveAsPreset) or a confirmation
   * message (manual audition). Either way native pushes the usual
   * /presets + /presets/selected events, so an open Expert Equalizer
   * re-syncs automatically.
   */
  apply (id: string, opts?: AutoEQApplyOptions) {
    return this.request({
      method: 'POST',
      endpoint: '/apply',
      data: {
        id,
        saveAsPreset: !!(opts && opts.saveAsPreset),
        ...(opts && opts.name ? { name: opts.name } : {})
      }
    })
  }
}
