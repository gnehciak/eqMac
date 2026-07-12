import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  HostBinding
} from '@angular/core'

import { AppMixerService, AppsChangedEventCallback, MixerApp } from './app-mixer.service'
import { ApplicationService } from '../../services/app.service'
import { SemanticVersion } from '../../services/semantic-version.service'

// First native version that ships the /app-mixer DataBus routes.
// Keep in sync with the actual release version of the App Mixer native feature.
export const APP_MIXER_MIN_NATIVE_VERSION = '1.4.0'

const EQMAC_BUNDLE_ID = 'com.bitgapp.eqmac'

@Component({
  selector: 'eqm-app-mixer',
  templateUrl: './app-mixer.component.html',
  styleUrls: [ './app-mixer.component.scss' ]
})
export class AppMixerComponent implements OnInit, OnDestroy {
  apps: MixerApp[] = []
  available = false
  synced = false

  // Pro-style vertical channel strips (icon on top, vertical fader,
  // percentage box at the bottom). Strips lay out horizontally and the
  // list scrolls sideways when there are more than fit (~4-7 visible).
  readonly stripWidth = 72
  readonly stripHeight = 240
  readonly verticalPadding = 16
  // Room under the strips for the horizontal scrollbar so it never
  // overlaps the percentage boxes.
  readonly scrollGutter = 24
  readonly emptyHeight = 44

  constructor (
    public mixer: AppMixerService,
    public app: ApplicationService,
    public changeRef: ChangeDetectorRef
  ) {}

  // Stable window-height participation: two states only — populated
  // (fixed strip height, list scrolls horizontally beyond that) or
  // empty/unavailable placeholder.
  @HostBinding('style.height.px') get height () {
    if (this.available && this.apps.length > 0) {
      return this.stripHeight + this.scrollGutter + this.verticalPadding
    }
    return this.emptyHeight
  }

  ngOnInit () {
    this.sync()
  }

  async sync () {
    const { version } = await this.app.getInfo()
    this.available = new SemanticVersion(version).isGreaterThanOrEqualTo(APP_MIXER_MIN_NATIVE_VERSION)
    if (this.available) {
      await this.syncApps()
      this.setupEvents()
    }
    this.synced = true
    this.detectChanges()
  }

  async syncApps () {
    const apps = await this.mixer.getApps()
    this.setApps(apps)
  }

  setApps (apps: MixerApp[]) {
    this.apps = (apps || [])
      .filter(mixerApp => !!(mixerApp && mixerApp.bundleId) && mixerApp.bundleId !== EQMAC_BUNDLE_ID)
      .slice()
      .sort((a, b) => this.sortName(a).localeCompare(this.sortName(b)))
    this.detectChanges()
  }

  private sortName (mixerApp: MixerApp) {
    return (mixerApp.name || mixerApp.bundleId || '').toLowerCase()
  }

  trackApp (index: number, mixerApp: MixerApp) {
    return mixerApp.bundleId
  }

  private onAppsChangedEventCallback: AppsChangedEventCallback

  protected setupEvents () {
    this.onAppsChangedEventCallback = data => {
      const apps = AppMixerService.parseApps(data)
      if (apps) {
        this.setApps(apps)
      } else {
        // Push didn't carry the list itself — treat it as an invalidation signal
        this.syncApps()
      }
    }
    this.mixer.onAppsChanged(this.onAppsChangedEventCallback)
  }

  protected destroyEvents () {
    if (this.onAppsChangedEventCallback) {
      this.mixer.offAppsChanged(this.onAppsChangedEventCallback)
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
    this.destroyEvents()
  }
}
