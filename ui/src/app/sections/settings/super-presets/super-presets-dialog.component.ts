import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  Inject,
  Optional
} from '@angular/core'
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog'
import {
  SuperPresetsService,
  SuperPresetRule,
  SuperPresetTriggerKind,
  SuperPresetEqualizerType,
  SuperPresetsRulesChangedEventCallback,
  SuperPresetsEnabledChangedEventCallback
} from './super-presets.service'
import { ApplicationService } from '../../../services/app.service'
import { SemanticVersion } from '../../../services/semantic-version.service'
import { TranslateService } from '../../../services/translate.service'
import { Subscription } from 'rxjs'
import { BasicEqualizerService } from '../../effects/equalizers/basic-equalizer/basic-equalizer.service'
import { AdvancedEqualizerService } from '../../effects/equalizers/advanced-equalizer/advanced-equalizer.service'
import { ExpertEqualizerService } from '../../effects/equalizers/expert-equalizer/expert-equalizer.service'
import { Graphic31EqualizerService } from '../../effects/equalizers/graphic31-equalizer/graphic31-equalizer.service'

// First native version that ships the /super-presets DataBus routes
// (and the Expert / Graphic31 Equalizer types).
// Keep in sync with the actual release version of the Super Presets native feature.
export const SUPER_PRESETS_MIN_NATIVE_VERSION = '1.4.0'

export interface SuperPresetsDialogData {
  title?: string
}

interface DropdownItem {
  id: string
  name: string
}

interface RuleRow {
  rule: SuperPresetRule
  kindItem: DropdownItem
  targetItems: DropdownItem[]
  targetItem?: DropdownItem
  typeItem?: DropdownItem
  presetItems: DropdownItem[]
  presetItem?: DropdownItem
}

@Component({
  selector: 'eqm-super-presets-dialog',
  templateUrl: './super-presets-dialog.component.html',
  styles: [ `
    .super-presets-dialog {
      min-width: 340px;
      max-width: 440px;
    }
    .super-presets-dialog .hint {
      opacity: 0.7;
    }
    .super-presets-dialog .rule {
      border: 1px solid var(--eqm-gradient-end, #2c2c2e);
      border-radius: 6px;
      padding: 8px;
    }
    .super-presets-dialog .rules {
      max-height: 320px;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .super-presets-dialog .pointer {
      cursor: pointer;
    }
    .super-presets-dialog .delete-button {
      flex-shrink: 0;
    }
  ` ]
})
export class SuperPresetsDialogComponent implements OnInit, OnDestroy {
  title = ''

  synced = false
  available = false
  enabled = false

  rules: SuperPresetRule[] = []
  rows: RuleRow[] = []

  // Labels come from the i18n catalog — retranslated in place on locale
  // change so dropdown selection references stay valid
  readonly kindItems: DropdownItem[] = [
    { id: 'device', name: '' },
    { id: 'app', name: '' }
  ]

  readonly typeItems: DropdownItem[] = [
    { id: 'Basic', name: '' },
    { id: 'Advanced', name: '' },
    { id: 'Expert', name: '' },
    { id: 'Graphic31', name: '' }
  ]

  private readonly typeLabelKeys: { [type: string]: string } = {
    Basic: 'equalizers.basic',
    Advanced: 'equalizers.advanced',
    Expert: 'equalizers.expert',
    Graphic31: 'equalizers.graphic31'
  }

  private applyTranslations () {
    this.kindItems[0].name = this.translate.instant('superPresets.kinds.device')
    this.kindItems[1].name = this.translate.instant('superPresets.kinds.app')
    for (const item of this.typeItems) {
      item.name = this.translate.instant(this.typeLabelKeys[item.id] || item.id)
    }
    if (!this.data || !this.data.title) {
      this.title = this.translate.instant('superPresets.title')
    }
  }

  deviceItems: DropdownItem[] = []
  appItems: DropdownItem[] = []
  presetsByType: { [type: string]: DropdownItem[] } = {}

  // Suppresses the /rules push event echo triggered by our own writes
  private ignoreUpdates = false
  private ignoreUpdatesTimer: any

  constructor (
    public superPresets: SuperPresetsService,
    public app: ApplicationService,
    private readonly basicEqualizer: BasicEqualizerService,
    private readonly advancedEqualizer: AdvancedEqualizerService,
    private readonly expertEqualizer: ExpertEqualizerService,
    private readonly graphic31Equalizer: Graphic31EqualizerService,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef,
    public dialogRef: MatDialogRef<SuperPresetsDialogComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data: SuperPresetsDialogData
  ) {
    this.applyTranslations()
    if (this.data && this.data.title) {
      this.title = this.data.title
    }
  }

  private localeChangedSubscription: Subscription

  ngOnInit () {
    this.localeChangedSubscription = this.translate.localeChanged.subscribe(() => {
      this.applyTranslations()
      this.buildRows()
      this.detectChanges()
    })
    this.sync()
  }

  async sync () {
    const { version } = await this.app.getInfo()
    this.available = new SemanticVersion(version).isGreaterThanOrEqualTo(SUPER_PRESETS_MIN_NATIVE_VERSION)

    if (this.available) {
      const [
        enabled,
        rules,
        options,
        basicPresets,
        advancedPresets,
        expertPresets,
        graphic31Presets
      ] = await Promise.all([
        this.superPresets.getEnabled(),
        this.superPresets.getRules(),
        this.superPresets.getOptions(),
        this.fetchPresets(this.basicEqualizer),
        this.fetchPresets(this.advancedEqualizer),
        this.fetchPresets(this.expertEqualizer),
        this.fetchPresets(this.graphic31Equalizer)
      ])

      this.enabled = enabled
      this.rules = Array.isArray(rules) ? rules : []
      this.deviceItems = ((options && options.devices) || []).map(device => ({ id: device.uid, name: device.name }))
      this.appItems = ((options && options.apps) || []).map(mixerApp => ({ id: mixerApp.bundleId, name: mixerApp.name }))
      this.presetsByType = {
        Basic: basicPresets,
        Advanced: advancedPresets,
        Expert: expertPresets,
        Graphic31: graphic31Presets
      }
      this.buildRows()
      this.setupEvents()
    }

    this.synced = true
    this.detectChanges()
  }

  private async fetchPresets (service: { getPresets: () => Promise<any> }): Promise<DropdownItem[]> {
    try {
      const presets = await service.getPresets()
      return (Array.isArray(presets) ? presets : [])
        .filter(preset => !!(preset && preset.id))
        .map(preset => ({ id: preset.id, name: preset.name || preset.id }))
    } catch (err) {
      // Preset routes for this Equalizer type aren't available -
      // its presets simply won't be offered
      return []
    }
  }

  // MARK: - Rows
  private buildRows () {
    this.rows = this.rules.map(rule => this.buildRow(rule))
  }

  private buildRow (rule: SuperPresetRule): RuleRow {
    const row: RuleRow = {
      rule,
      kindItem: this.kindItems.find(kind => kind.id === rule.trigger.kind) || this.kindItems[0],
      targetItems: [],
      presetItems: []
    }
    this.refreshRow(row)
    return row
  }

  private refreshRow (row: RuleRow) {
    const rule = row.rule

    row.kindItem = this.kindItems.find(kind => kind.id === rule.trigger.kind) || this.kindItems[0]

    const isDevice = rule.trigger.kind === 'device'
    const targetId = isDevice ? rule.trigger.deviceUID : rule.trigger.bundleId
    row.targetItems = (isDevice ? this.deviceItems : this.appItems).slice()
    row.targetItem = row.targetItems.find(item => item.id === targetId)
    if (!row.targetItem && targetId) {
      // Referenced device / app is currently unavailable - still show it
      row.targetItem = {
        id: targetId,
        name: this.translate.instant(
          isDevice ? 'superPresets.disconnected' : 'superPresets.notRunning',
          { id: targetId }
        )
      }
      row.targetItems.push(row.targetItem)
    }

    row.typeItem = this.typeItems.find(type => type.id === rule.equalizerType)
    row.presetItems = (this.presetsByType[rule.equalizerType] || []).slice()
    row.presetItem = row.presetItems.find(preset => preset.id === rule.presetId)
    if (!row.presetItem && rule.presetId) {
      row.presetItem = { id: rule.presetId, name: rule.presetId }
      row.presetItems.push(row.presetItem)
    }
  }

  trackRow (index: number, row: RuleRow) {
    return row.rule.id || index
  }

  // MARK: - User actions
  toggleEnabled () {
    this.setEnabled(!this.enabled)
  }

  setEnabled (enabled: boolean) {
    this.enabled = enabled
    this.detectChanges()
    this.superPresets.setEnabled(enabled)
  }

  selectKind (row: RuleRow, item: DropdownItem) {
    if (row.rule.trigger.kind === item.id) return
    const kind = item.id as SuperPresetTriggerKind
    row.rule.trigger.kind = kind
    if (kind === 'device') {
      row.rule.trigger.deviceUID = this.deviceItems.length > 0 ? this.deviceItems[0].id : undefined
      row.rule.trigger.bundleId = undefined
    } else {
      row.rule.trigger.bundleId = this.appItems.length > 0 ? this.appItems[0].id : undefined
      row.rule.trigger.deviceUID = undefined
    }
    this.rowChanged(row)
  }

  selectTarget (row: RuleRow, item: DropdownItem) {
    if (row.rule.trigger.kind === 'device') {
      if (row.rule.trigger.deviceUID === item.id) return
      row.rule.trigger.deviceUID = item.id
    } else {
      if (row.rule.trigger.bundleId === item.id) return
      row.rule.trigger.bundleId = item.id
    }
    this.rowChanged(row)
  }

  selectType (row: RuleRow, item: DropdownItem) {
    if (row.rule.equalizerType === item.id) return
    row.rule.equalizerType = item.id as SuperPresetEqualizerType
    // Preset lists are per type - fall back to the always-present 'flat' preset
    const presets = this.presetsByType[row.rule.equalizerType] || []
    row.rule.presetId = presets.some(preset => preset.id === 'flat') || presets.length === 0
      ? 'flat'
      : presets[0].id
    this.rowChanged(row)
  }

  selectPreset (row: RuleRow, item: DropdownItem) {
    if (row.rule.presetId === item.id) return
    row.rule.presetId = item.id
    this.rowChanged(row)
  }

  toggleRevert (row: RuleRow) {
    row.rule.revert = !row.rule.revert
    this.rowChanged(row)
  }

  async addRule () {
    const rule: SuperPresetRule = {
      trigger: this.deviceItems.length > 0
        ? { kind: 'device', deviceUID: this.deviceItems[0].id }
        : { kind: 'app', bundleId: this.appItems.length > 0 ? this.appItems[0].id : undefined },
      equalizerType: 'Basic',
      presetId: 'flat',
      revert: false
    }
    const saved = await this.saveRule(rule)
    this.rules.push(saved || rule)
    this.buildRows()
    this.detectChanges()
  }

  async deleteRule (row: RuleRow) {
    const index = this.rules.indexOf(row.rule)
    if (index >= 0) {
      this.rules.splice(index, 1)
    }
    this.buildRows()
    this.detectChanges()
    if (row.rule.id) {
      this.suppressUpdates()
      try {
        await this.superPresets.deleteRule(row.rule)
      } catch (err) {}
    }
  }

  private async rowChanged (row: RuleRow) {
    this.refreshRow(row)
    this.detectChanges()
    const saved = await this.saveRule(row.rule)
    if (saved && saved.id && !row.rule.id) {
      row.rule.id = saved.id
    }
  }

  private async saveRule (rule: SuperPresetRule): Promise<SuperPresetRule | null> {
    this.suppressUpdates()
    try {
      const saved = await this.superPresets.upsertRule(rule)
      if (saved && saved.id && !rule.id) {
        rule.id = saved.id
      }
      return saved || null
    } catch (err) {
      return null
    }
  }

  private suppressUpdates () {
    this.ignoreUpdates = true
    if (this.ignoreUpdatesTimer) {
      clearTimeout(this.ignoreUpdatesTimer)
    }
    this.ignoreUpdatesTimer = setTimeout(() => {
      this.ignoreUpdates = false
    }, 500)
  }

  close () {
    this.dialogRef.close()
  }

  // MARK: - Events
  private onRulesChangedCallback: SuperPresetsRulesChangedEventCallback
  private onEnabledChangedCallback: SuperPresetsEnabledChangedEventCallback

  private setupEvents () {
    this.onRulesChangedCallback = rules => {
      if (this.ignoreUpdates) return
      if (!Array.isArray(rules)) return
      this.rules = rules
      this.buildRows()
      this.detectChanges()
    }
    this.superPresets.onRulesChanged(this.onRulesChangedCallback)

    this.onEnabledChangedCallback = data => {
      if (this.ignoreUpdates) return
      if (data && typeof data.enabled === 'boolean') {
        this.enabled = data.enabled
        this.detectChanges()
      }
    }
    this.superPresets.onEnabledChanged(this.onEnabledChangedCallback)
  }

  private destroyEvents () {
    if (this.onRulesChangedCallback) {
      this.superPresets.offRulesChanged(this.onRulesChangedCallback)
    }
    if (this.onEnabledChangedCallback) {
      this.superPresets.offEnabledChanged(this.onEnabledChangedCallback)
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
    this.localeChangedSubscription?.unsubscribe()
    if (this.ignoreUpdatesTimer) {
      clearTimeout(this.ignoreUpdatesTimer)
    }
    this.destroyEvents()
  }
}
