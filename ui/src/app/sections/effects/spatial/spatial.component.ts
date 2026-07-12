import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  HostBinding
} from '@angular/core'

import { KnobValueChangedEvent, FlatSliderValueChangedEvent } from '@eqmac/components'
import { Subscription } from 'rxjs'

import {
  SpatialService,
  SpatialEnvironment,
  SpatialEnvironments,
  SPATIAL_DEFAULT_ENVIRONMENT,
  SPATIAL_DEFAULT_WET_DRY_MIX,
  SpatialEnvironmentChangedEventCallback,
  SpatialWetDryMixChangedEventCallback
} from './spatial.service'
import { EffectEnabledChangedEventCallback } from '../effect.service'
import { ApplicationService } from '../../../services/app.service'
import { UIService } from '../../../services/ui.service'
import { SemanticVersion } from '../../../services/semantic-version.service'
import { TranslateService } from '../../../services/translate.service'

// First native version that ships the /effects/reverb DataBus routes.
// Keep in sync with the actual release version of the Spatial native feature.
export const SPATIAL_MIN_NATIVE_VERSION = '1.4.0'

export interface SpatialEnvironmentItem {
  id: SpatialEnvironment
  name: string
}

// Display names come from the i18n catalog (spatial.environments.*) —
// items are retranslated in place on locale change so the dropdown's
// selected item reference stays valid
const ENVIRONMENT_NAME_KEY_PREFIX = 'spatial.environments.'

@Component({
  selector: 'eqm-spatial',
  templateUrl: './spatial.component.html',
  styleUrls: [ './spatial.component.scss' ]
})
export class SpatialComponent implements OnInit, OnDestroy {
  environments: SpatialEnvironmentItem[] = SpatialEnvironments
    .map(id => ({ id, name: '' }))

  private applyTranslations () {
    for (const item of this.environments) {
      item.name = this.translate.instant(`${ENVIRONMENT_NAME_KEY_PREFIX}${item.id}`)
    }
  }

  minNativeVersion = SPATIAL_MIN_NATIVE_VERSION

  enabled = false
  wetDryMix = SPATIAL_DEFAULT_WET_DRY_MIX
  selectedEnvironmentItem: SpatialEnvironmentItem =
    this.environments.find(environment => environment.id === SPATIAL_DEFAULT_ENVIRONMENT)

  available = false
  synced = false
  replaceKnobsWithSliders = false

  // Stable window-height participation - AppComponent polls and sums
  // section heights every second, so this must not jitter.
  // Pro-reference card layout: header row + environment/mix content row.
  @HostBinding('style.height.px') get height () {
    return 110
  }

  // Proposed 'spatial.dryWetMix' key falls back to the existing
  // 'spatial.mix' entry until the integration pass lands it in the i18n
  // catalogs, so no raw dot-key ever hits the screen.
  get dryWetMixLabelKey (): string {
    return this.translate.has('spatial.dryWetMix') ? 'spatial.dryWetMix' : 'spatial.mix'
  }

  constructor (
    public spatialService: SpatialService,
    public app: ApplicationService,
    public ui: UIService,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef
  ) {
    this.applyTranslations()
  }

  private onLocaleChangedSubscription: Subscription

  ngOnInit () {
    this.onLocaleChangedSubscription = this.translate.localeChanged.subscribe(() => {
      this.applyTranslations()
      this.detectChanges()
    })
    this.sync()
  }

  async sync () {
    const [ { version } ] = await Promise.all([
      this.app.getInfo(),
      this.syncUISettings()
    ])
    this.available = new SemanticVersion(version).isGreaterThanOrEqualTo(SPATIAL_MIN_NATIVE_VERSION)
    if (this.available) {
      await Promise.all([
        this.getEnabled(),
        this.getEnvironment(),
        this.getWetDryMix()
      ])
      this.setupEvents()
    }
    this.synced = true
    this.detectChanges()
  }

  async syncUISettings () {
    const uiSettings = await this.ui.getSettings()
    this.replaceKnobsWithSliders = !!uiSettings.replaceKnobsWithSliders
  }

  async getEnabled () {
    this.enabled = await this.spatialService.getEnabled()
  }

  async getEnvironment () {
    const environment = await this.spatialService.getEnvironment()
    this.selectEnvironmentItem(environment)
  }

  async getWetDryMix () {
    this.wetDryMix = await this.spatialService.getWetDryMix()
  }

  private selectEnvironmentItem (environment: SpatialEnvironment) {
    const item = this.environments.find(({ id }) => id === environment)
    if (item) this.selectedEnvironmentItem = item
  }

  public ignoreUpdates = false
  public ignoreUpdatesDebouncer: NodeJS.Timer

  private onEnabledChangedEventCallback: EffectEnabledChangedEventCallback
  private onEnvironmentChangedEventCallback: SpatialEnvironmentChangedEventCallback
  private onWetDryMixChangedEventCallback: SpatialWetDryMixChangedEventCallback
  private onUISettingsChangedEventSubscription: Subscription

  protected setupEvents () {
    this.onEnabledChangedEventCallback = ({ enabled }) => {
      this.enabled = enabled
      this.detectChanges()
    }
    this.spatialService.onEnabledChanged(this.onEnabledChangedEventCallback)

    this.onEnvironmentChangedEventCallback = ({ environment }) => {
      this.selectEnvironmentItem(environment)
      this.detectChanges()
    }
    this.spatialService.onEnvironmentChanged(this.onEnvironmentChangedEventCallback)

    this.onWetDryMixChangedEventCallback = ({ wetDryMix }) => {
      if (!this.ignoreUpdates) {
        this.wetDryMix = wetDryMix
        this.detectChanges()
      }
    }
    this.spatialService.onWetDryMixChanged(this.onWetDryMixChangedEventCallback)

    this.onUISettingsChangedEventSubscription = this.ui.settingsChanged.subscribe(uiSettings => {
      this.replaceKnobsWithSliders = !!uiSettings.replaceKnobsWithSliders
    })
  }

  protected destroyEvents () {
    if (this.onEnabledChangedEventCallback) {
      this.spatialService.offEnabledChanged(this.onEnabledChangedEventCallback)
    }
    if (this.onEnvironmentChangedEventCallback) {
      this.spatialService.offEnvironmentChanged(this.onEnvironmentChangedEventCallback)
    }
    if (this.onWetDryMixChangedEventCallback) {
      this.spatialService.offWetDryMixChanged(this.onWetDryMixChangedEventCallback)
    }
    this.onUISettingsChangedEventSubscription?.unsubscribe()
  }

  setEnabled (enabled: boolean) {
    this.enabled = enabled
    this.spatialService.setEnabled(enabled)
  }

  selectEnvironment (item: SpatialEnvironmentItem) {
    this.selectedEnvironmentItem = item
    this.spatialService.setEnvironment(item.id)
  }

  setWetDryMix (event: KnobValueChangedEvent | FlatSliderValueChangedEvent) {
    this.wetDryMix = event.value
    this.ignoreUpdates = true
    if (this.ignoreUpdatesDebouncer) clearTimeout(this.ignoreUpdatesDebouncer)
    this.ignoreUpdatesDebouncer = setTimeout(() => {
      this.getWetDryMix()
      this.ignoreUpdates = false
    }, 1000)
    this.detectChanges()
    this.sendWetDryMix(event.value)
  }

  // Knob drags fire on every mousemove - throttle the native requests to
  // <= 30Hz (trailing edge kept so the final value always lands).
  private wetDryMixSendThrottle: NodeJS.Timer = null
  private pendingWetDryMix: number = null

  private sendWetDryMix (wetDryMix: number) {
    if (this.wetDryMixSendThrottle) {
      this.pendingWetDryMix = wetDryMix
      return
    }
    this.spatialService.setWetDryMix(wetDryMix)
    this.wetDryMixSendThrottle = setTimeout(() => {
      this.wetDryMixSendThrottle = null
      if (this.pendingWetDryMix !== null) {
        const pending = this.pendingWetDryMix
        this.pendingWetDryMix = null
        this.sendWetDryMix(pending)
      }
    }, 33)
  }

  performHapticFeedback (animating) {
    if (!animating) {
      this.app.haptic()
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
    this.onLocaleChangedSubscription?.unsubscribe()
    this.destroyEvents()
  }
}
