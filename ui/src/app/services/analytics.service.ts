import { Injectable } from '@angular/core'
import { UtilitiesService } from './utilities.service'
import { ApplicationService } from './app.service'
import { UIService } from './ui.service'

/**
 * Fork: analytics are removed entirely.
 *
 * The original service injected Google Analytics (analytics.js) and reported
 * screenviews to the vendor's GA property (UA-96287398-6). This open-source
 * fork sends NO telemetry to anyone, so every method here is a deliberate
 * no-op. The class and its `init()` / `deinit()` surface are kept only so the
 * existing callers (AppComponent, SettingsComponent) compile unchanged; they
 * simply do nothing.
 */
@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  constructor (
    public utils: UtilitiesService,
    public app: ApplicationService,
    private readonly ui: UIService
  ) {}

  async init () { /* no-op: this fork collects no analytics */ }

  deinit () { /* no-op: nothing was ever initialized */ }
}
