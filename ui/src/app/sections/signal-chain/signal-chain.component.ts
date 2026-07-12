import {
  Component,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
  HostBinding,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core'
import { Subscription } from 'rxjs'

import { ApplicationService } from '../../services/app.service'
import { TranslateService, TranslationParams } from '../../services/translate.service'

import { EffectEnabledChangedEventCallback } from '../effects/effect.service'
import {
  RoutingService,
  RoutingMode,
  RoutingPolarity,
  RoutingModeChangedEventCallback,
  RoutingPolarityChangedEventCallback
} from '../effects/audio-effects/routing.service'
import {
  CrossfeedService,
  CrossfeedSettingsChangedEventCallback
} from '../effects/audio-effects/crossfeed.service'
import {
  ChannelDelayService,
  ChannelDelaySettingsChangedEventCallback
} from '../effects/audio-effects/channel-delay.service'
import {
  PreampService,
  PreampGainChangedEventCallback,
  PreampAutoGainChangedEventCallback
} from '../effects/audio-effects/preamp.service'
import {
  SpatialService,
  SpatialEnvironment,
  SpatialEnvironmentChangedEventCallback
} from '../effects/spatial/spatial.service'
import {
  AudioUnitsService,
  AudioUnitChainItem,
  AudioUnitsChainChangedEventCallback
} from '../effects/audio-units/audio-units.service'
import {
  EqualizersService,
  EqualizerType,
  EqualizersTypeChangedEventCallback
} from '../effects/equalizers/equalizers.service'
import {
  ExpertEqualizerService,
  ExpertEqualizerSelectedPresetChangedEventCallback,
  ExpertEqualizerPresetsChangedEventCallback
} from '../effects/equalizers/expert-equalizer/expert-equalizer.service'
import {
  OutputsService,
  OutputsSelectedChangedEventCallback,
  OutputsDevicesChangedEventCallback
} from '../outputs/outputs.service'

// Processing order of the audio pipeline exactly as the DSP graph runs it.
// System and Output are non-toggleable I/O endpoints (dashed, no power dot);
// everything in between is a bypassable stage with a power dot + one-line
// status. Clicking a stage's dot toggles its enabled flag; clicking the body
// emits (focusStage) so the shell can scroll/highlight the matching module.
export type SignalStageId =
  | 'system'
  | 'routing'
  | 'eq'
  | 'crossfeed'
  | 'delay'
  | 'preamp'
  | 'spatial'
  | 'fx'
  | 'output'

export interface SignalChainNode {
  id: SignalStageId
  // Uppercased for display in SCSS (text-transform), stored title-case so
  // aria-labels read naturally.
  label: string
  status: string
  // I/O endpoint: dashed, static, no power dot.
  io: boolean
  // Whether the stage's underlying native route answered during sync. A stage
  // whose calls threw (older native / missing route) stays unavailable: shown
  // greyed with an 'unknown' status and a disabled dot, never crashing.
  available: boolean
  enabled: boolean
}

@Component({
  selector: 'eqm-signal-chain',
  templateUrl: './signal-chain.component.html',
  styleUrls: [ './signal-chain.component.scss' ],
  // The strip is push-driven: it only re-renders when a service fires a
  // *Changed event (or the user toggles a dot), never per animation frame.
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SignalChainComponent implements OnInit, OnDestroy {
  // Emits the SignalStageId of the clicked node body. The shell wires this to
  // scroll to / highlight the corresponding deck module.
  @Output() focusStage = new EventEmitter<string>()

  // Fixed ~54px strip that lives directly under the titlebar. Constant so the
  // AppComponent window-dimensions poll never jitters because of it.
  @HostBinding('style.height.px') readonly height = 54

  // Fixed-identity node view-models, mutated in place by rebuild() so *ngFor
  // never tears down/re-creates DOM on a status change.
  nodes: SignalChainNode[] = [
    this.blankNode('system', true),
    this.blankNode('routing', false),
    this.blankNode('eq', false),
    this.blankNode('crossfeed', false),
    this.blankNode('delay', false),
    this.blankNode('preamp', false),
    this.blankNode('spatial', false),
    this.blankNode('fx', false),
    this.blankNode('output', true)
  ]

  // ----- Per-stage state (source of truth for rebuild()) -----

  private routingAvailable = false
  private routingEnabled = false
  private routingMode: RoutingMode = 'stereo'
  private routingPolarity: RoutingPolarity = { left: false, right: false }

  private eqAvailable = false
  private eqEnabled = false
  private eqType: EqualizerType = 'Basic'
  private eqPresetName = ''
  private eqBandCount: number | null = null

  private crossfeedAvailable = false
  private crossfeedEnabled = false
  private crossfeedCutoff = 0
  private crossfeedLevel = 0

  private delayAvailable = false
  private delayEnabled = false
  private delayLeftMs = 0
  private delayRightMs = 0

  private preampAvailable = false
  private preampEnabled = false
  private preampGain = 0
  private preampAutoGain = false

  private spatialAvailable = false
  private spatialEnabled = false
  private spatialEnvironment: SpatialEnvironment = 'mediumRoom'

  private fxAvailable = false
  private fxEnabled = false
  private fxCount = 0

  private outputAvailable = false
  private outputName = ''

  constructor (
    public routingService: RoutingService,
    public crossfeedService: CrossfeedService,
    public delayService: ChannelDelayService,
    public preampService: PreampService,
    public spatialService: SpatialService,
    public audioUnitsService: AudioUnitsService,
    public equalizersService: EqualizersService,
    public expertEqualizerService: ExpertEqualizerService,
    public outputsService: OutputsService,
    public app: ApplicationService,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef
  ) {}

  async ngOnInit () {
    this.rebuild()
    await this.sync()
    this.setupEvents()
  }

  // ----- Initial sync (parallel, each stage isolated so one failure can't
  // sink the strip) -----

  async sync () {
    await Promise.all([
      this.syncRouting(),
      this.syncEq(),
      this.syncCrossfeed(),
      this.syncDelay(),
      this.syncPreamp(),
      this.syncSpatial(),
      this.syncFx(),
      this.syncOutput()
    ])
    this.rebuild()
    this.detectChanges()
  }

  private async syncRouting () {
    try {
      const [ enabled, mode, polarity ] = await Promise.all([
        this.routingService.getEnabled(),
        this.routingService.getMode(),
        this.routingService.getPolarity()
      ])
      this.routingEnabled = !!enabled
      this.routingMode = mode
      this.routingPolarity = polarity
      this.routingAvailable = true
    } catch (err) {
      this.routingAvailable = false
    }
  }

  private async syncEq () {
    try {
      const [ enabled, type ] = await Promise.all([
        this.equalizersService.getEnabled(),
        this.equalizersService.getType()
      ])
      this.eqEnabled = !!enabled
      this.eqType = type
      this.eqAvailable = true
    } catch (err) {
      this.eqAvailable = false
    }
    // Preset name + band count come from the parametric preset store and are
    // best-effort: on older native without it the EQ node simply shows its
    // type label with no band count.
    await this.syncEqPreset()
  }

  private async syncEqPreset () {
    try {
      const preset = await this.expertEqualizerService.getSelectedPreset()
      this.eqPresetName = preset?.name ?? ''
      this.eqBandCount = Array.isArray(preset?.bands) ? preset.bands.length : null
    } catch (err) {
      this.eqPresetName = ''
      this.eqBandCount = null
    }
  }

  private async syncCrossfeed () {
    try {
      const [ enabled, settings ] = await Promise.all([
        this.crossfeedService.getEnabled(),
        this.crossfeedService.getSettings()
      ])
      this.crossfeedEnabled = !!enabled
      this.crossfeedCutoff = settings.cutoff
      this.crossfeedLevel = settings.level
      this.crossfeedAvailable = true
    } catch (err) {
      this.crossfeedAvailable = false
    }
  }

  private async syncDelay () {
    try {
      const [ enabled, settings ] = await Promise.all([
        this.delayService.getEnabled(),
        this.delayService.getSettings()
      ])
      this.delayEnabled = !!enabled
      this.delayLeftMs = settings.leftMs
      this.delayRightMs = settings.rightMs
      this.delayAvailable = true
    } catch (err) {
      this.delayAvailable = false
    }
  }

  private async syncPreamp () {
    try {
      const [ enabled, gain, autoGain ] = await Promise.all([
        this.preampService.getEnabled(),
        this.preampService.getGain(),
        this.preampService.getAutoGain()
      ])
      this.preampEnabled = !!enabled
      this.preampGain = gain
      this.preampAutoGain = !!autoGain
      this.preampAvailable = true
    } catch (err) {
      this.preampAvailable = false
    }
  }

  private async syncSpatial () {
    try {
      const [ enabled, environment ] = await Promise.all([
        this.spatialService.getEnabled(),
        this.spatialService.getEnvironment()
      ])
      this.spatialEnabled = !!enabled
      this.spatialEnvironment = environment
      this.spatialAvailable = true
    } catch (err) {
      this.spatialAvailable = false
    }
  }

  private async syncFx () {
    try {
      const [ enabled, chain ] = await Promise.all([
        this.audioUnitsService.getEnabled(),
        this.audioUnitsService.getChain()
      ])
      this.fxEnabled = !!enabled
      this.fxCount = chain.length
      this.fxAvailable = true
    } catch (err) {
      this.fxAvailable = false
    }
  }

  private async syncOutput () {
    try {
      const selected = await this.outputsService.getSelected()
      this.outputName = selected?.name ?? ''
      this.outputAvailable = true
    } catch (err) {
      this.outputAvailable = false
    }
  }

  // ----- Push events -----

  private onRoutingEnabledCb?: EffectEnabledChangedEventCallback
  private onRoutingModeCb?: RoutingModeChangedEventCallback
  private onRoutingPolarityCb?: RoutingPolarityChangedEventCallback
  private onEqEnabledCb?: EffectEnabledChangedEventCallback
  private onEqTypeCb?: EqualizersTypeChangedEventCallback
  private onEqSelectedPresetCb?: ExpertEqualizerSelectedPresetChangedEventCallback
  private onEqPresetsCb?: ExpertEqualizerPresetsChangedEventCallback
  private onCrossfeedEnabledCb?: EffectEnabledChangedEventCallback
  private onCrossfeedSettingsCb?: CrossfeedSettingsChangedEventCallback
  private onDelayEnabledCb?: EffectEnabledChangedEventCallback
  private onDelaySettingsCb?: ChannelDelaySettingsChangedEventCallback
  private onPreampEnabledCb?: EffectEnabledChangedEventCallback
  private onPreampGainCb?: PreampGainChangedEventCallback
  private onPreampAutoGainCb?: PreampAutoGainChangedEventCallback
  private onSpatialEnabledCb?: EffectEnabledChangedEventCallback
  private onSpatialEnvironmentCb?: SpatialEnvironmentChangedEventCallback
  private onFxEnabledCb?: EffectEnabledChangedEventCallback
  private onFxChainCb?: AudioUnitsChainChangedEventCallback
  private onOutputSelectedCb?: OutputsSelectedChangedEventCallback
  private onOutputDevicesCb?: OutputsDevicesChangedEventCallback
  private localeSubscription?: Subscription

  private setupEvents () {
    // Registering a listener for a route the running native build never emits
    // (older versions) is harmless — it simply never fires.

    this.onRoutingEnabledCb = ({ enabled }) => this.apply(() => { this.routingEnabled = !!enabled })
    this.routingService.onEnabledChanged(this.onRoutingEnabledCb)
    this.onRoutingModeCb = ({ mode }) => this.apply(() => { this.routingMode = mode })
    this.routingService.onModeChanged(this.onRoutingModeCb)
    this.onRoutingPolarityCb = ({ left, right }) => this.apply(() => { this.routingPolarity = { left: !!left, right: !!right } })
    this.routingService.onPolarityChanged(this.onRoutingPolarityCb)

    this.onEqEnabledCb = ({ enabled }) => this.apply(() => { this.eqEnabled = !!enabled })
    this.equalizersService.onEnabledChanged(this.onEqEnabledCb)
    this.onEqTypeCb = ({ type }) => this.apply(() => { this.eqType = type })
    this.equalizersService.onTypeChanged(this.onEqTypeCb)
    this.onEqSelectedPresetCb = preset => this.apply(() => {
      this.eqPresetName = preset?.name ?? ''
      this.eqBandCount = Array.isArray(preset?.bands) ? preset.bands.length : this.eqBandCount
    })
    this.expertEqualizerService.onSelectedPresetChanged(this.onEqSelectedPresetCb)
    this.onEqPresetsCb = () => { this.syncEqPreset().then(() => this.apply(() => {})) }
    this.expertEqualizerService.onPresetsChanged(this.onEqPresetsCb)

    this.onCrossfeedEnabledCb = ({ enabled }) => this.apply(() => { this.crossfeedEnabled = !!enabled })
    this.crossfeedService.onEnabledChanged(this.onCrossfeedEnabledCb)
    this.onCrossfeedSettingsCb = ({ cutoff, level }) => this.apply(() => {
      this.crossfeedCutoff = cutoff
      this.crossfeedLevel = level
    })
    this.crossfeedService.onSettingsChanged(this.onCrossfeedSettingsCb)

    this.onDelayEnabledCb = ({ enabled }) => this.apply(() => { this.delayEnabled = !!enabled })
    this.delayService.onEnabledChanged(this.onDelayEnabledCb)
    this.onDelaySettingsCb = ({ leftMs, rightMs }) => this.apply(() => {
      this.delayLeftMs = leftMs
      this.delayRightMs = rightMs
    })
    this.delayService.onSettingsChanged(this.onDelaySettingsCb)

    this.onPreampEnabledCb = ({ enabled }) => this.apply(() => { this.preampEnabled = !!enabled })
    this.preampService.onEnabledChanged(this.onPreampEnabledCb)
    this.onPreampGainCb = ({ gain }) => this.apply(() => { this.preampGain = gain })
    this.preampService.onGainChanged(this.onPreampGainCb)
    this.onPreampAutoGainCb = data => {
      const value = typeof data?.autoGain === 'boolean' ? data.autoGain : data?.enabled
      if (typeof value === 'boolean') this.apply(() => { this.preampAutoGain = value })
    }
    this.preampService.onAutoGainChanged(this.onPreampAutoGainCb)

    this.onSpatialEnabledCb = ({ enabled }) => this.apply(() => { this.spatialEnabled = !!enabled })
    this.spatialService.onEnabledChanged(this.onSpatialEnabledCb)
    this.onSpatialEnvironmentCb = ({ environment }) => this.apply(() => { this.spatialEnvironment = environment })
    this.spatialService.onEnvironmentChanged(this.onSpatialEnvironmentCb)

    this.onFxEnabledCb = ({ enabled }) => this.apply(() => { this.fxEnabled = !!enabled })
    this.audioUnitsService.onEnabledChanged(this.onFxEnabledCb)
    this.onFxChainCb = data => {
      const list = AudioUnitsService.parseList<AudioUnitChainItem>(data)
      if (list) {
        this.apply(() => { this.fxCount = list.length })
      } else {
        this.syncFx().then(() => this.apply(() => {}))
      }
    }
    this.audioUnitsService.onChainChanged(this.onFxChainCb)

    this.onOutputSelectedCb = () => { this.syncOutput().then(() => this.apply(() => {})) }
    this.outputsService.onSelectedChanged(this.onOutputSelectedCb)
    this.onOutputDevicesCb = () => { this.syncOutput().then(() => this.apply(() => {})) }
    this.outputsService.onDevicesChanged(this.onOutputDevicesCb)

    // User-facing labels are retranslated in place on locale switch.
    this.localeSubscription = this.translate.localeChanged.subscribe(() => this.apply(() => {}))
  }

  private destroyEvents () {
    if (this.onRoutingEnabledCb) this.routingService.offEnabledChanged(this.onRoutingEnabledCb)
    if (this.onRoutingModeCb) this.routingService.offModeChanged(this.onRoutingModeCb)
    if (this.onRoutingPolarityCb) this.routingService.offPolarityChanged(this.onRoutingPolarityCb)
    if (this.onEqEnabledCb) this.equalizersService.offEnabledChanged(this.onEqEnabledCb)
    if (this.onEqTypeCb) this.equalizersService.offTypeChanged(this.onEqTypeCb)
    if (this.onEqSelectedPresetCb) this.expertEqualizerService.offSelectedPresetChanged(this.onEqSelectedPresetCb)
    if (this.onEqPresetsCb) this.expertEqualizerService.offPresetsChanged(this.onEqPresetsCb)
    if (this.onCrossfeedEnabledCb) this.crossfeedService.offEnabledChanged(this.onCrossfeedEnabledCb)
    if (this.onCrossfeedSettingsCb) this.crossfeedService.offSettingsChanged(this.onCrossfeedSettingsCb)
    if (this.onDelayEnabledCb) this.delayService.offEnabledChanged(this.onDelayEnabledCb)
    if (this.onDelaySettingsCb) this.delayService.offSettingsChanged(this.onDelaySettingsCb)
    if (this.onPreampEnabledCb) this.preampService.offEnabledChanged(this.onPreampEnabledCb)
    if (this.onPreampGainCb) this.preampService.offGainChanged(this.onPreampGainCb)
    if (this.onPreampAutoGainCb) this.preampService.offAutoGainChanged(this.onPreampAutoGainCb)
    if (this.onSpatialEnabledCb) this.spatialService.offEnabledChanged(this.onSpatialEnabledCb)
    if (this.onSpatialEnvironmentCb) this.spatialService.offEnvironmentChanged(this.onSpatialEnvironmentCb)
    if (this.onFxEnabledCb) this.audioUnitsService.offEnabledChanged(this.onFxEnabledCb)
    if (this.onFxChainCb) this.audioUnitsService.offChainChanged(this.onFxChainCb)
    if (this.onOutputSelectedCb) this.outputsService.offSelectedChanged(this.onOutputSelectedCb)
    if (this.onOutputDevicesCb) this.outputsService.offDevicesChanged(this.onOutputDevicesCb)
    if (this.localeSubscription) this.localeSubscription.unsubscribe()
  }

  // Runs a state mutation from a push callback (which arrives outside Angular's
  // template-event path), then rebuilds + flushes CD once.
  private apply (mutate: () => void) {
    mutate()
    this.rebuild()
    this.detectChanges()
  }

  // ----- Interactions -----

  toggle (node: SignalChainNode, event: Event) {
    event.stopPropagation()
    if (node.io || !node.available) return
    const next = !node.enabled
    node.enabled = next
    this.setStageEnabled(node.id, next)
    this.rebuild()
    this.detectChanges()
  }

  private setStageEnabled (id: SignalStageId, enabled: boolean) {
    const setters: { [key in SignalStageId]?: (enabled: boolean) => Promise<any> } = {
      routing: e => this.routingService.setEnabled(e),
      eq: e => this.equalizersService.setEnabled(e),
      crossfeed: e => this.crossfeedService.setEnabled(e),
      delay: e => this.delayService.setEnabled(e),
      preamp: e => this.preampService.setEnabled(e),
      spatial: e => this.spatialService.setEnabled(e),
      fx: e => this.audioUnitsService.setEnabled(e)
    }
    const setter = setters[id]
    if (!setter) return
    try {
      // Swallow rejections so a version-gated / offline stage never surfaces an
      // unhandled rejection; the next push event (if any) reconciles state.
      Promise.resolve(setter(enabled)).catch(() => {})
    } catch (err) {
      // Synchronous throw from an older native contract: keep optimistic state.
    }
  }

  focus (node: SignalChainNode) {
    this.focusStage.emit(node.id)
  }

  trackById (_index: number, node: SignalChainNode) {
    return node.id
  }

  // ----- Aria helpers (template) -----

  get ariaChainLabel (): string {
    return this.t('signalChain.aria.chain', 'Signal chain')
  }

  powerLabel (node: SignalChainNode): string {
    const state = node.enabled
      ? this.t('common.on', 'On')
      : this.t('common.off', 'Off')
    return `${node.label} — ${state}`
  }

  focusLabel (node: SignalChainNode): string {
    return `${node.label}: ${node.status}`
  }

  // ----- Rebuild view-models from state -----

  private rebuild () {
    for (const node of this.nodes) {
      node.label = this.nodeLabel(node.id)
      node.status = this.nodeStatus(node.id)
      node.available = this.nodeAvailable(node.id)
      node.enabled = this.nodeEnabled(node.id)
    }
  }

  private nodeLabel (id: SignalStageId): string {
    const fallbacks: { [key in SignalStageId]: string } = {
      system: 'System',
      routing: 'Routing',
      eq: 'EQ',
      crossfeed: 'Crossfeed',
      delay: 'Delay',
      preamp: 'Preamp',
      spatial: 'Spatial',
      fx: 'FX',
      output: 'Output'
    }
    return this.t(`signalChain.nodes.${id}`, fallbacks[id])
  }

  private nodeAvailable (id: SignalStageId): boolean {
    switch (id) {
      case 'system': return true
      case 'routing': return this.routingAvailable
      case 'eq': return this.eqAvailable
      case 'crossfeed': return this.crossfeedAvailable
      case 'delay': return this.delayAvailable
      case 'preamp': return this.preampAvailable
      case 'spatial': return this.spatialAvailable
      case 'fx': return this.fxAvailable
      case 'output': return this.outputAvailable
    }
  }

  private nodeEnabled (id: SignalStageId): boolean {
    switch (id) {
      case 'routing': return this.routingEnabled
      case 'eq': return this.eqEnabled
      case 'crossfeed': return this.crossfeedEnabled
      case 'delay': return this.delayEnabled
      case 'preamp': return this.preampEnabled
      case 'spatial': return this.spatialEnabled
      case 'fx': return this.fxEnabled
      default: return false
    }
  }

  private nodeStatus (id: SignalStageId): string {
    switch (id) {
      case 'system': return this.t('signalChain.status.allAudio', 'all audio')
      case 'routing': return this.routingStatus()
      case 'eq': return this.eqStatus()
      case 'crossfeed': return this.crossfeedStatus()
      case 'delay': return this.delayStatus()
      case 'preamp': return this.preampStatus()
      case 'spatial': return this.spatialStatus()
      case 'fx': return this.fxStatus()
      case 'output': return this.outputStatus()
    }
  }

  private routingStatus (): string {
    if (!this.routingAvailable) return this.unknown()
    const modeKeys: { [mode in RoutingMode]: string } = {
      stereo: 'effects.routing.modes.stereo',
      monoDownmix: 'effects.routing.modes.mono',
      swap: 'effects.routing.modes.swap',
      leftToBoth: 'effects.routing.modes.leftToBoth',
      rightToBoth: 'effects.routing.modes.rightToBoth'
    }
    const modeFallbacks: { [mode in RoutingMode]: string } = {
      stereo: 'Stereo',
      monoDownmix: 'Mono',
      swap: 'Swap L/R',
      leftToBoth: 'Left to Both',
      rightToBoth: 'Right to Both'
    }
    const mode = this.t(modeKeys[this.routingMode], modeFallbacks[this.routingMode])
    const { left, right } = this.routingPolarity
    let polarity: string
    if (left && right) {
      polarity = `${this.t('common.leftShort', 'L')}+${this.t('common.rightShort', 'R')}`
    } else if (left) {
      polarity = this.t('common.leftShort', 'L')
    } else if (right) {
      polarity = this.t('common.rightShort', 'R')
    } else {
      polarity = this.t('signalChain.status.polarityOff', 'off')
    }
    return `${mode} · Ø ${polarity}`
  }

  private eqStatus (): string {
    if (!this.eqAvailable) return this.unknown()
    // Parametric (Expert) is the only density with a live preset store wired
    // here, so it shows "<preset> · N bands" from the parametric selection.
    // The fixed-density graphic modes report their inherent band count, which
    // is always truthful without pulling in their separate preset services.
    if (this.eqType === 'Expert') {
      const name = this.eqPresetName || this.t('equalizers.expert', 'Parametric')
      if (this.eqBandCount === null) return name
      return `${name} · ${this.bandCountLabel(this.eqBandCount)}`
    }
    const fixedBandCount: { [type in Exclude<EqualizerType, 'Expert'>]: number } = {
      Basic: 3,
      Advanced: 10,
      Graphic31: 31
    }
    return this.bandCountLabel(fixedBandCount[this.eqType])
  }

  private bandCountLabel (count: number): string {
    const word = count === 1
      ? this.t('signalChain.status.band', 'band')
      : this.t('signalChain.status.bands', 'bands')
    return `${count} ${word}`
  }

  private crossfeedStatus (): string {
    if (!this.crossfeedAvailable) return this.unknown()
    if (!this.crossfeedEnabled) return this.t('signalChain.status.bypassed', 'bypassed')
    return `${Math.round(this.crossfeedCutoff)}Hz · ${this.fmtNumber(this.crossfeedLevel)}`
  }

  private delayStatus (): string {
    if (!this.delayAvailable) return this.unknown()
    const unit = this.t('signalChain.status.ms', 'ms')
    return `${this.fmtNumber(this.delayLeftMs)} · ${this.fmtNumber(this.delayRightMs)} ${unit}`
  }

  private preampStatus (): string {
    if (!this.preampAvailable) return this.unknown()
    const db = this.t('signalChain.status.db', 'dB')
    const base = `${this.fmtGain(this.preampGain)} ${db}`
    return this.preampAutoGain ? `${base} ${this.t('signalChain.status.auto', 'auto')}` : base
  }

  private spatialStatus (): string {
    if (!this.spatialAvailable) return this.unknown()
    return this.t(`spatial.environments.${this.spatialEnvironment}`, this.spatialEnvironment)
  }

  private fxStatus (): string {
    if (!this.fxAvailable) return this.unknown()
    const word = this.fxCount === 1
      ? this.t('signalChain.status.unit', 'unit')
      : this.t('signalChain.status.units', 'units')
    return `${this.fxCount} ${word}`
  }

  private outputStatus (): string {
    if (!this.outputAvailable || !this.outputName) return this.unknown()
    return this.outputName
  }

  // ----- Formatting -----

  private unknown (): string {
    return this.t('signalChain.status.unknown', 'unknown')
  }

  // Up to one decimal, trailing '.0' stripped (0 -> '0', 5 -> '5', 5.2 -> '5.2')
  private fmtNumber (value: number): string {
    if (!isFinite(value)) return '0'
    const rounded = Math.round(value * 10) / 10
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1)
  }

  // Preamp gain keeps a fixed decimal + explicit sign feel (e.g. '-6.4')
  private fmtGain (value: number): string {
    if (!isFinite(value)) return '0.0'
    return (Math.round(value * 10) / 10).toFixed(1)
  }

  // Translated string with a plain-English fallback when the proposed
  // signalChain.* key is not yet in the i18n catalog (so no raw dot-key ever
  // reaches the screen). Mirrors SpatialComponent's translate.has() guard.
  private t (key: string, fallback: string, params?: TranslationParams): string {
    if (this.translate.has(key)) return this.translate.instant(key, params)
    if (!params) return fallback
    return fallback.replace(/\{(\w+)\}/g, (match, param) => {
      const replacement = params[param]
      return typeof replacement === 'undefined' ? match : `${replacement}`
    })
  }

  private blankNode (id: SignalStageId, io: boolean): SignalChainNode {
    return { id, label: '', status: '', io, available: io, enabled: false }
  }

  private destroyed = false
  private detectChanges () {
    if (!this.destroyed) this.changeRef.detectChanges()
  }

  ngOnDestroy () {
    this.destroyed = true
    this.destroyEvents()
  }
}
