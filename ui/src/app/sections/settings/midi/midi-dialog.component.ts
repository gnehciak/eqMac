import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef
} from '@angular/core'
import { MatDialogRef } from '@angular/material/dialog'
import {
  MIDIService,
  MIDIDevice,
  MIDIMapping,
  MIDIMappingTarget,
  MIDIMappingsChangedEventCallback,
  MIDIDevicesChangedEventCallback
} from './midi.service'
import { ApplicationService } from '../../../services/app.service'
import { SemanticVersion } from '../../../services/semantic-version.service'
import { TranslateService } from '../../../services/translate.service'
import { Subscription } from 'rxjs'

// First native version that ships the /midi DataBus routes.
// Keep in sync with the actual release version of the MIDI native feature.
export const MIDI_MIN_NATIVE_VERSION = '1.4.0'

export interface MIDITargetOption {
  id: MIDIMappingTarget
  name: string
}

@Component({
  selector: 'eqm-midi-dialog',
  templateUrl: './midi-dialog.component.html',
  // Styles are inline on purpose - this package only ships the .ts/.html
  // pair. Colors come exclusively from the theme CSS custom properties.
  styles: [ `
    .midi-dialog {
      width: 420px;
      max-width: 100%;
      box-sizing: border-box;
    }

    .title {
      margin-bottom: 5px;
    }

    .placeholder {
      padding: 20px 0;
    }

    .devices {
      max-height: 90px;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .device-row {
      min-height: 18px;
    }

    .device-state {
      opacity: 0.6;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      min-width: 7px;
      border-radius: 50%;
    }

    .status-dot.online {
      background: var(--eqm-accent, #4f8d71);
    }

    .status-dot.offline {
      background: var(--eqm-warning, #eb3f42);
    }

    .mappings {
      max-height: 220px;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .mapping-row {
      min-height: 26px;
    }

    .target-dropdown {
      width: 140px;
      min-width: 140px;
    }

    .source-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .source-label.listening,
    eqm-label.listening {
      animation: eqm-midi-listening-pulse 1s ease-in-out infinite;
    }

    .button-container {
      width: 21px;
      min-width: 21px;
      height: 21px;
    }

    @keyframes eqm-midi-listening-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
  ` ]
})
export class MIDIDialogComponent implements OnInit, OnDestroy {
  available = false
  synced = false

  enabled = false
  devices: MIDIDevice[] = []
  mappings: MIDIMapping[] = []

  // Target currently armed for MIDI Learn (spinner state)
  learningTarget: MIDIMappingTarget = null
  // Target picked in the "Add mapping" row, not learned yet
  draftTarget: MIDITargetOption = null

  // Labels come from the i18n catalog (midi.targets.*) — retranslated in
  // place on locale change so dropdown selection references stay valid
  readonly targets: MIDITargetOption[] = [
    { id: 'volume', name: '' },
    { id: 'balance', name: '' },
    { id: 'preampGain', name: '' },
    { id: 'presetNext', name: '' },
    { id: 'presetPrevious', name: '' },
    { id: 'muteToggle', name: '' },
    { id: 'enabledToggle', name: '' }
  ]

  private applyTranslations () {
    for (const target of this.targets) {
      target.name = this.translate.instant(`midi.targets.${target.id}`)
    }
  }

  constructor (
    public dialogRef: MatDialogRef<MIDIDialogComponent>,
    public midi: MIDIService,
    public app: ApplicationService,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef
  ) {
    this.applyTranslations()
  }

  private localeChangedSubscription: Subscription

  ngOnInit () {
    this.localeChangedSubscription = this.translate.localeChanged.subscribe(() => {
      this.applyTranslations()
      this.detectChanges()
    })
    this.sync()
  }

  async sync () {
    const { version } = await this.app.getInfo()
    this.available = new SemanticVersion(version).isGreaterThanOrEqualTo(MIDI_MIN_NATIVE_VERSION)
    if (this.available) {
      await Promise.all([
        this.syncEnabled(),
        this.syncDevices(),
        this.syncMappings()
      ])
      this.setupEvents()
    }
    this.synced = true
    this.detectChanges()
  }

  async syncEnabled () {
    this.enabled = await this.midi.getEnabled()
    this.detectChanges()
  }

  async syncDevices () {
    this.devices = await this.midi.getDevices()
    this.detectChanges()
  }

  async syncMappings () {
    this.mappings = await this.midi.getMappings()
    this.detectChanges()
  }

  async setEnabled (enabled: boolean) {
    this.enabled = enabled
    await this.midi.setEnabled(enabled)
  }

  // MARK: - Mappings table

  getTargetOption (id: MIDIMappingTarget) {
    return this.targets.find(target => target.id === id)
  }

  /**
   * Options for a row's target dropdown: every target not taken by another
   * mapping (+ the row's own). For the "Add mapping" row pass null.
   */
  availableTargets (mapping?: MIDIMapping): MIDITargetOption[] {
    const used = this.mappings
      .filter(other => !mapping || other.id !== mapping.id)
      .map(other => other.target)
    return this.targets.filter(target => !used.includes(target.id))
  }

  sourceLabel (mapping: MIDIMapping) {
    if (!mapping || !mapping.source) return this.translate.instant('midi.notLearned')
    const kind = this.translate.instant(
      mapping.source.kind === 'cc' ? 'midi.cc' : 'midi.note',
      { number: mapping.source.number }
    )
    const channel = mapping.source.channel >= 0
      ? this.translate.instant('midi.channel', { channel: mapping.source.channel + 1 })
      : this.translate.instant('midi.anyChannel')
    return `${kind} · ${channel}`
  }

  trackMapping (index: number, mapping: MIDIMapping) {
    return mapping.id
  }

  async onTargetSelected (mapping: MIDIMapping, option: MIDITargetOption) {
    if (!option || option.id === mapping.target) return
    mapping.target = option.id
    await this.midi.setMappingTarget({ id: mapping.id, target: option.id })
    await this.syncMappings()
  }

  async deleteMapping (mapping: MIDIMapping) {
    if (this.learningTarget === mapping.target) {
      await this.cancelLearn()
    }
    await this.midi.deleteMapping({ id: mapping.id })
    await this.syncMappings()
  }

  // MARK: - Learn

  async learn (target: MIDIMappingTarget) {
    if (!target) return
    if (this.learningTarget === target) {
      // Second click on the listening button cancels
      return this.cancelLearn()
    }
    // If another target is armed, native replaces the pending learn itself
    this.learningTarget = target
    this.detectChanges()
    try {
      await this.midi.learn({ target })
      if (this.draftTarget && this.draftTarget.id === target) {
        this.draftTarget = null
      }
      await this.syncMappings()
    } catch (err) {
      // Timeout / cancellation - DataService already showed a toast
    } finally {
      if (this.learningTarget === target) {
        this.learningTarget = null
      }
      this.detectChanges()
    }
  }

  async cancelLearn () {
    try {
      await this.midi.cancelLearn()
    } catch (err) {
      // The pending learn request will reject on its own
    }
  }

  // MARK: - Events

  private onMappingsChangedEventCallback: MIDIMappingsChangedEventCallback
  private onDevicesChangedEventCallback: MIDIDevicesChangedEventCallback

  protected setupEvents () {
    this.onMappingsChangedEventCallback = mappings => {
      if (Array.isArray(mappings)) {
        this.mappings = mappings
        this.detectChanges()
      }
    }
    this.midi.onMappingsChanged(this.onMappingsChangedEventCallback)

    this.onDevicesChangedEventCallback = devices => {
      if (Array.isArray(devices)) {
        this.devices = devices
        this.detectChanges()
      }
    }
    this.midi.onDevicesChanged(this.onDevicesChangedEventCallback)
  }

  protected destroyEvents () {
    if (this.onMappingsChangedEventCallback) {
      this.midi.offMappingsChanged(this.onMappingsChangedEventCallback)
    }
    if (this.onDevicesChangedEventCallback) {
      this.midi.offDevicesChanged(this.onDevicesChangedEventCallback)
    }
  }

  close () {
    this.dialogRef.close()
  }

  private destroyed = false
  private detectChanges () {
    if (!this.destroyed) {
      this.changeRef.detectChanges()
    }
  }

  ngOnDestroy () {
    this.destroyed = true
    this.localeChangedSubscription?.unsubscribe()
    if (this.learningTarget) {
      this.cancelLearn()
    }
    this.destroyEvents()
  }
}
