import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  HostBinding
} from '@angular/core'
import { Subscription } from 'rxjs'

import { UIService, UISettings } from '../../../services/ui.service'
import { ApplicationService } from '../../../services/app.service'
import { SemanticVersion } from '../../../services/semantic-version.service'
import { TranslateService } from '../../../services/translate.service'
import { EffectEnabledChangedEventCallback } from '../effect.service'
import {
  CrossfeedService,
  CrossfeedSettingsChangedEventCallback,
  CROSSFEED_CUTOFF_MIN,
  CROSSFEED_CUTOFF_MAX,
  CROSSFEED_CUTOFF_DEFAULT,
  CROSSFEED_LEVEL_MIN,
  CROSSFEED_LEVEL_MAX,
  CROSSFEED_LEVEL_DEFAULT
} from './crossfeed.service'
import {
  ChannelDelayService,
  ChannelDelaySettingsChangedEventCallback,
  CHANNEL_DELAY_MS_MIN,
  CHANNEL_DELAY_MS_MAX
} from './channel-delay.service'
import {
  RoutingService,
  RoutingMode,
  RoutingModeChangedEventCallback,
  RoutingPolarityChangedEventCallback
} from './routing.service'
import {
  PreampService,
  PreampGainChangedEventCallback,
  PreampAutoGainChangedEventCallback,
  PREAMP_GAIN_MIN,
  PREAMP_GAIN_MAX
} from './preamp.service'

// First native version that ships the /effects/{crossfeed,delay,routing,preamp}
// DataBus routes. Keep in sync with the actual release version of the
// Effects suite native feature.
export const EFFECTS_SUITE_MIN_NATIVE_VERSION = '1.4.0'

// UISettings extension keys owned by this section. The shared interface in
// ui.service.ts is integration-owned, so they are typed locally here
// (same approach as ThemeUISettings in theme.service.ts).
interface EffectsUISettings extends UISettings {
  effectsFeatureEnabled?: boolean
  showEffects?: boolean
}

export interface RoutingModeItem {
  id: RoutingMode
  name: string
}

type EchoDomain = 'crossfeed' | 'delay' | 'preamp'

@Component({
  selector: 'eqm-audio-effects',
  templateUrl: './audio-effects.component.html',
  styleUrls: [ './audio-effects.component.scss' ]
})
export class AudioEffectsComponent implements OnInit, OnDestroy {
  loaded = false
  available = false
  show = true
  replaceKnobsWithSliders = false

  // Ranges (template bindings)
  readonly cutoffMin = CROSSFEED_CUTOFF_MIN
  readonly cutoffMax = CROSSFEED_CUTOFF_MAX
  readonly levelMin = CROSSFEED_LEVEL_MIN
  readonly levelMax = CROSSFEED_LEVEL_MAX
  readonly delayMin = CHANNEL_DELAY_MS_MIN
  readonly delayMax = CHANNEL_DELAY_MS_MAX
  readonly gainMin = PREAMP_GAIN_MIN
  readonly gainMax = PREAMP_GAIN_MAX

  // Crossfeed
  crossfeedEnabled = false
  crossfeedCutoff = CROSSFEED_CUTOFF_DEFAULT
  crossfeedLevel = CROSSFEED_LEVEL_DEFAULT

  // Channel Delay
  delayEnabled = false
  delayLeftMs = 0
  delayRightMs = 0

  // Routing
  routingEnabled = false
  // Labels come from the i18n catalog — rebuilt in place on locale change
  // (item identity is preserved so the dropdown selection stays valid)
  routingModes: RoutingModeItem[] = [
    { id: 'stereo', name: '' },
    { id: 'monoDownmix', name: '' },
    { id: 'swap', name: '' },
    { id: 'leftToBoth', name: '' },
    { id: 'rightToBoth', name: '' }
  ]

  private readonly routingModeLabelKeys: { [mode in RoutingMode]?: string } = {
    stereo: 'effects.routing.modes.stereo',
    monoDownmix: 'effects.routing.modes.mono',
    swap: 'effects.routing.modes.swap',
    leftToBoth: 'effects.routing.modes.leftToBoth',
    rightToBoth: 'effects.routing.modes.rightToBoth'
  }

  selectedRoutingMode: RoutingModeItem = this.routingModes[0]

  // Peace-style per-channel polarity (phase) inversion
  invertLeft = false
  invertRight = false

  private applyTranslations () {
    for (const item of this.routingModes) {
      item.name = this.translate.instant(this.routingModeLabelKeys[item.id] || item.id)
    }
  }

  // Preamp
  preampEnabled = false
  preampGain = 0
  autoGain = false

  // Stable height participation: the section is toolbar-only when collapsed
  // and toolbar + a fixed-size content block when expanded. Never varies
  // with data, so the 1s window-dimensions poll in AppComponent stays calm.
  readonly toolbarHeight = 30
  readonly knobRowHeight = 54
  readonly compactRowHeight = 28
  readonly contentPadding = 8

  get contentHeight () {
    return this.knobRowHeight + 3 * this.compactRowHeight + this.contentPadding
  }

  @HostBinding('style.height.px') get height () {
    return this.toolbarHeight + (this.show ? this.contentHeight : 0)
  }

  constructor (
    public crossfeedService: CrossfeedService,
    public delayService: ChannelDelayService,
    public routingService: RoutingService,
    public preampService: PreampService,
    public app: ApplicationService,
    public ui: UIService,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef
  ) {
    this.applyTranslations()
  }

  get crossfeedControlsEnabled () {
    return this.app.enabled && this.crossfeedEnabled
  }

  get delayControlsEnabled () {
    return this.app.enabled && this.delayEnabled
  }

  get routingControlsEnabled () {
    return this.app.enabled && this.routingEnabled
  }

  get preampControlsEnabled () {
    return this.app.enabled && this.preampEnabled
  }

  ngOnInit () {
    this.sync()
  }

  async sync () {
    const [ { version }, uiSettings ] = await Promise.all([
      this.app.getInfo(),
      this.ui.getSettings()
    ])
    const settings = uiSettings as EffectsUISettings
    this.show = settings.showEffects !== false
    this.replaceKnobsWithSliders = !!settings.replaceKnobsWithSliders
    this.available = new SemanticVersion(version)
      .isGreaterThanOrEqualTo(EFFECTS_SUITE_MIN_NATIVE_VERSION)
    this.setupUIEvents()
    if (this.available) {
      await this.syncEffects()
      this.setupEvents()
    }
    this.loaded = true
    this.detectChanges()
  }

  async syncEffects () {
    const [
      crossfeedEnabled,
      crossfeedSettings,
      delayEnabled,
      delaySettings,
      routingEnabled,
      routingMode,
      routingPolarity,
      preampEnabled,
      preampGain,
      autoGain
    ] = await Promise.all([
      this.crossfeedService.getEnabled(),
      this.crossfeedService.getSettings(),
      this.delayService.getEnabled(),
      this.delayService.getSettings(),
      this.routingService.getEnabled(),
      this.routingService.getMode(),
      this.routingService.getPolarity(),
      this.preampService.getEnabled(),
      this.preampService.getGain(),
      this.preampService.getAutoGain()
    ])
    this.crossfeedEnabled = !!crossfeedEnabled
    this.crossfeedCutoff = crossfeedSettings.cutoff
    this.crossfeedLevel = crossfeedSettings.level
    this.delayEnabled = !!delayEnabled
    this.delayLeftMs = delaySettings.leftMs
    this.delayRightMs = delaySettings.rightMs
    this.routingEnabled = !!routingEnabled
    this.setRoutingModeFromId(routingMode)
    this.invertLeft = routingPolarity.left
    this.invertRight = routingPolarity.right
    this.preampEnabled = !!preampEnabled
    this.preampGain = preampGain
    this.autoGain = autoGain
    this.detectChanges()
  }

  private setRoutingModeFromId (mode: RoutingMode) {
    this.selectedRoutingMode =
      this.routingModes.find(item => item.id === mode) || this.routingModes[0]
  }

  async syncCrossfeedSettings () {
    const { cutoff, level } = await this.crossfeedService.getSettings()
    this.crossfeedCutoff = cutoff
    this.crossfeedLevel = level
    this.detectChanges()
  }

  async syncDelaySettings () {
    const { leftMs, rightMs } = await this.delayService.getSettings()
    this.delayLeftMs = leftMs
    this.delayRightMs = rightMs
    this.detectChanges()
  }

  async syncPreampGain () {
    this.preampGain = await this.preampService.getGain()
    this.detectChanges()
  }

  // ----- Events -----

  private onCrossfeedEnabledChangedEventCallback: EffectEnabledChangedEventCallback
  private onCrossfeedSettingsChangedEventCallback: CrossfeedSettingsChangedEventCallback
  private onDelayEnabledChangedEventCallback: EffectEnabledChangedEventCallback
  private onDelaySettingsChangedEventCallback: ChannelDelaySettingsChangedEventCallback
  private onRoutingEnabledChangedEventCallback: EffectEnabledChangedEventCallback
  private onRoutingModeChangedEventCallback: RoutingModeChangedEventCallback
  private onRoutingPolarityChangedEventCallback: RoutingPolarityChangedEventCallback
  private onPreampEnabledChangedEventCallback: EffectEnabledChangedEventCallback
  private onPreampGainChangedEventCallback: PreampGainChangedEventCallback
  private onPreampAutoGainChangedEventCallback: PreampAutoGainChangedEventCallback
  private onUISettingsChangedEventSubscription: Subscription
  private onLocaleChangedSubscription: Subscription

  private setupUIEvents () {
    this.onUISettingsChangedEventSubscription = this.ui.settingsChanged
      .subscribe(uiSettings => {
        const settings = uiSettings as EffectsUISettings
        this.replaceKnobsWithSliders = !!settings.replaceKnobsWithSliders
        if (typeof settings.showEffects === 'boolean') {
          this.show = settings.showEffects
        }
        this.detectChanges()
      })
    this.onLocaleChangedSubscription = this.translate.localeChanged
      .subscribe(() => {
        this.applyTranslations()
        this.detectChanges()
      })
  }

  protected setupEvents () {
    this.onCrossfeedEnabledChangedEventCallback = ({ enabled }) => {
      this.crossfeedEnabled = enabled
      this.detectChanges()
    }
    this.crossfeedService.onEnabledChanged(this.onCrossfeedEnabledChangedEventCallback)

    this.onCrossfeedSettingsChangedEventCallback = ({ cutoff, level }) => {
      if (this.ignoreUpdates.crossfeed) return
      this.crossfeedCutoff = cutoff
      this.crossfeedLevel = level
      this.detectChanges()
    }
    this.crossfeedService.onSettingsChanged(this.onCrossfeedSettingsChangedEventCallback)

    this.onDelayEnabledChangedEventCallback = ({ enabled }) => {
      this.delayEnabled = enabled
      this.detectChanges()
    }
    this.delayService.onEnabledChanged(this.onDelayEnabledChangedEventCallback)

    this.onDelaySettingsChangedEventCallback = ({ leftMs, rightMs }) => {
      if (this.ignoreUpdates.delay) return
      this.delayLeftMs = leftMs
      this.delayRightMs = rightMs
      this.detectChanges()
    }
    this.delayService.onSettingsChanged(this.onDelaySettingsChangedEventCallback)

    this.onRoutingEnabledChangedEventCallback = ({ enabled }) => {
      this.routingEnabled = enabled
      this.detectChanges()
    }
    this.routingService.onEnabledChanged(this.onRoutingEnabledChangedEventCallback)

    this.onRoutingModeChangedEventCallback = ({ mode }) => {
      this.setRoutingModeFromId(mode)
      this.detectChanges()
    }
    this.routingService.onModeChanged(this.onRoutingModeChangedEventCallback)

    this.onRoutingPolarityChangedEventCallback = ({ left, right }) => {
      this.invertLeft = !!left
      this.invertRight = !!right
      this.detectChanges()
    }
    this.routingService.onPolarityChanged(this.onRoutingPolarityChangedEventCallback)

    this.onPreampEnabledChangedEventCallback = ({ enabled }) => {
      this.preampEnabled = enabled
      this.detectChanges()
    }
    this.preampService.onEnabledChanged(this.onPreampEnabledChangedEventCallback)

    this.onPreampGainChangedEventCallback = ({ gain }) => {
      if (this.ignoreUpdates.preamp) return
      this.preampGain = gain
      this.detectChanges()
    }
    this.preampService.onGainChanged(this.onPreampGainChangedEventCallback)

    this.onPreampAutoGainChangedEventCallback = data => {
      const value = typeof data?.autoGain === 'boolean' ? data.autoGain : data?.enabled
      if (typeof value === 'boolean') {
        this.autoGain = value
        this.detectChanges()
      }
    }
    this.preampService.onAutoGainChanged(this.onPreampAutoGainChangedEventCallback)
  }

  protected destroyEvents () {
    if (this.onCrossfeedEnabledChangedEventCallback) {
      this.crossfeedService.offEnabledChanged(this.onCrossfeedEnabledChangedEventCallback)
    }
    if (this.onCrossfeedSettingsChangedEventCallback) {
      this.crossfeedService.offSettingsChanged(this.onCrossfeedSettingsChangedEventCallback)
    }
    if (this.onDelayEnabledChangedEventCallback) {
      this.delayService.offEnabledChanged(this.onDelayEnabledChangedEventCallback)
    }
    if (this.onDelaySettingsChangedEventCallback) {
      this.delayService.offSettingsChanged(this.onDelaySettingsChangedEventCallback)
    }
    if (this.onRoutingEnabledChangedEventCallback) {
      this.routingService.offEnabledChanged(this.onRoutingEnabledChangedEventCallback)
    }
    if (this.onRoutingModeChangedEventCallback) {
      this.routingService.offModeChanged(this.onRoutingModeChangedEventCallback)
    }
    if (this.onRoutingPolarityChangedEventCallback) {
      this.routingService.offPolarityChanged(this.onRoutingPolarityChangedEventCallback)
    }
    if (this.onPreampEnabledChangedEventCallback) {
      this.preampService.offEnabledChanged(this.onPreampEnabledChangedEventCallback)
    }
    if (this.onPreampGainChangedEventCallback) {
      this.preampService.offGainChanged(this.onPreampGainChangedEventCallback)
    }
    if (this.onPreampAutoGainChangedEventCallback) {
      this.preampService.offAutoGainChanged(this.onPreampAutoGainChangedEventCallback)
    }
    if (this.onUISettingsChangedEventSubscription) {
      this.onUISettingsChangedEventSubscription.unsubscribe()
    }
    if (this.onLocaleChangedSubscription) {
      this.onLocaleChangedSubscription.unsubscribe()
    }
  }

  // ----- Echo suppression (booster.component.ts pattern, keyed per effect) -----

  public ignoreUpdates: { [domain in EchoDomain]?: boolean } = {}
  private readonly ignoreUpdatesDebouncers: { [domain in EchoDomain]?: NodeJS.Timer } = {}

  private suppressEcho (domain: EchoDomain, resync: () => void) {
    this.ignoreUpdates[domain] = true
    const existing = this.ignoreUpdatesDebouncers[domain]
    if (existing) clearTimeout(existing as any)
    this.ignoreUpdatesDebouncers[domain] = setTimeout(() => {
      resync()
      this.ignoreUpdates[domain] = false
    }, 1000)
  }

  // ----- POST throttling (sliders/knobs emit per mousemove; keep <=~20Hz) -----

  private readonly postThrottleMs = 50
  private readonly postThrottleTimers: { [key: string]: NodeJS.Timer } = {}
  private readonly postThrottleLastSent: { [key: string]: number } = {}

  private throttledPost (key: string, post: () => void) {
    const existing = this.postThrottleTimers[key]
    if (existing) {
      clearTimeout(existing as any)
      delete this.postThrottleTimers[key]
    }
    const now = Date.now()
    const elapsed = now - (this.postThrottleLastSent[key] || 0)
    if (elapsed >= this.postThrottleMs) {
      this.postThrottleLastSent[key] = now
      post()
    } else {
      this.postThrottleTimers[key] = setTimeout(() => {
        delete this.postThrottleTimers[key]
        this.postThrottleLastSent[key] = Date.now()
        post()
      }, this.postThrottleMs - elapsed)
    }
  }

  // ----- Setters -----

  setCrossfeedEnabled (enabled: boolean) {
    this.crossfeedEnabled = enabled
    this.crossfeedService.setEnabled(enabled)
  }

  setCrossfeedCutoff (cutoff: number) {
    this.crossfeedCutoff = cutoff
    this.suppressEcho('crossfeed', () => this.syncCrossfeedSettings())
    this.throttledPost('crossfeed-cutoff', () => this.crossfeedService.setSettings({ cutoff }))
  }

  setCrossfeedLevel (level: number) {
    this.crossfeedLevel = level
    this.suppressEcho('crossfeed', () => this.syncCrossfeedSettings())
    this.throttledPost('crossfeed-level', () => this.crossfeedService.setSettings({ level }))
  }

  setDelayEnabled (enabled: boolean) {
    this.delayEnabled = enabled
    this.delayService.setEnabled(enabled)
  }

  setDelayLeft (leftMs: number) {
    this.delayLeftMs = leftMs
    this.suppressEcho('delay', () => this.syncDelaySettings())
    this.throttledPost('delay-left', () => this.delayService.setSettings({ leftMs }))
  }

  setDelayRight (rightMs: number) {
    this.delayRightMs = rightMs
    this.suppressEcho('delay', () => this.syncDelaySettings())
    this.throttledPost('delay-right', () => this.delayService.setSettings({ rightMs }))
  }

  setRoutingEnabled (enabled: boolean) {
    this.routingEnabled = enabled
    this.routingService.setEnabled(enabled)
  }

  setRoutingMode (item: RoutingModeItem) {
    if (!item) return
    this.selectedRoutingMode = item
    this.routingService.setMode(item.id)
  }

  setInvertLeft (invert: boolean) {
    this.invertLeft = invert
    this.routingService.setPolarity({ left: invert })
  }

  setInvertRight (invert: boolean) {
    this.invertRight = invert
    this.routingService.setPolarity({ right: invert })
  }

  setPreampEnabled (enabled: boolean) {
    this.preampEnabled = enabled
    this.preampService.setEnabled(enabled)
  }

  setPreampGain (gain: number) {
    this.preampGain = gain
    this.suppressEcho('preamp', () => this.syncPreampGain())
    this.throttledPost('preamp-gain', () => this.preampService.setGain(gain))
  }

  setAutoGain (autoGain: boolean) {
    this.autoGain = autoGain
    this.preampService.setAutoGain(autoGain)
  }

  // ----- Section visibility -----

  toggleVisibility () {
    this.show = !this.show
    const settings: Partial<EffectsUISettings> = { showEffects: this.show }
    this.ui.setSettings(settings)
  }

  performHapticFeedback (animating: boolean) {
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
    this.destroyEvents()
    for (const timer of Object.values(this.ignoreUpdatesDebouncers)) {
      if (timer) clearTimeout(timer as any)
    }
    for (const timer of Object.values(this.postThrottleTimers)) {
      if (timer) clearTimeout(timer as any)
    }
  }
}
