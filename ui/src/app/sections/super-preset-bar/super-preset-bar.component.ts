import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  HostBinding
} from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { Subscription } from 'rxjs'

import {
  SuperPresetsService,
  SuperPresetRule,
  SuperPresetsRulesChangedEventCallback,
  SuperPresetsEnabledChangedEventCallback
} from '../settings/super-presets/super-presets.service'
import {
  SuperPresetsDialogComponent,
  SUPER_PRESETS_MIN_NATIVE_VERSION
} from '../settings/super-presets/super-presets-dialog.component'
import { ApplicationService } from '../../services/app.service'
import { SemanticVersion } from '../../services/semantic-version.service'
import { TranslateService } from '../../services/translate.service'

export interface SuperPresetRuleItem {
  id: string
  name: string
  rule: SuperPresetRule
}

interface NamedOption {
  id: string
  name: string
}

/**
 * Compact Pro-reference "Super Preset" rail card: enable dot + rule
 * dropdown + edit (pencil) / add (+) buttons which open the existing
 * SuperPresetsDialog. Pure presentation over SuperPresetsService - all
 * rule editing still happens in the dialog.
 */
@Component({
  selector: 'eqm-super-preset-bar',
  templateUrl: './super-preset-bar.component.html',
  styleUrls: [ './super-preset-bar.component.scss' ]
})
export class SuperPresetBarComponent implements OnInit, OnDestroy {
  synced = false
  available = false
  enabled = false

  rules: SuperPresetRule[] = []
  ruleItems: SuperPresetRuleItem[] = []
  selectedRuleItem: SuperPresetRuleItem = null

  private deviceOptions: NamedOption[] = []
  private appOptions: NamedOption[] = []

  // Stable window-height participation - AppComponent polls and sums
  // section heights every second, so this must not jitter.
  @HostBinding('style.height.px') get height () {
    return 64
  }

  constructor (
    public superPresets: SuperPresetsService,
    public app: ApplicationService,
    public dialog: MatDialog,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef
  ) {}

  // The proposed keys fall back to existing catalog entries until the
  // integration pass lands them in the i18n files, so no raw dot-keys
  // ever hit the screen.
  get titleLabelKey (): string {
    return this.translate.has('superPresets.barTitle') ? 'superPresets.barTitle' : 'superPresets.title'
  }

  get editTooltipKey (): string {
    return this.translate.has('superPresets.editRules') ? 'superPresets.editRules' : 'superPresets.title'
  }

  private onLocaleChangedSubscription: Subscription

  ngOnInit () {
    // Rule labels are built in TS - rebuild them when the user switches language
    this.onLocaleChangedSubscription = this.translate.localeChanged.subscribe(() => {
      this.buildRuleItems()
      this.detectChanges()
    })
    this.sync()
  }

  async sync () {
    const { version } = await this.app.getInfo()
    this.available = new SemanticVersion(version).isGreaterThanOrEqualTo(SUPER_PRESETS_MIN_NATIVE_VERSION)
    if (this.available) {
      await Promise.all([
        this.getEnabled(),
        this.fetchRulesAndOptions()
      ])
      this.setupEvents()
    }
    this.synced = true
    this.detectChanges()
  }

  async getEnabled () {
    this.enabled = await this.superPresets.getEnabled()
  }

  private async fetchRulesAndOptions () {
    const [ rules, options ] = await Promise.all([
      this.superPresets.getRules(),
      this.superPresets.getOptions()
    ])
    this.deviceOptions = ((options && options.devices) || []).map(device => ({ id: device.uid, name: device.name }))
    this.appOptions = ((options && options.apps) || []).map(mixerApp => ({ id: mixerApp.bundleId, name: mixerApp.name }))
    this.rules = Array.isArray(rules) ? rules : []
    this.buildRuleItems()
  }

  private buildRuleItems () {
    const previousSelectedId = this.selectedRuleItem ? this.selectedRuleItem.id : null
    this.ruleItems = this.rules
      .filter(rule => !!rule)
      .map((rule, index) => ({
        id: rule.id || `unsaved-${index}`,
        name: this.ruleItemName(rule),
        rule
      }))
    this.selectedRuleItem = previousSelectedId
      ? this.ruleItems.find(item => item.id === previousSelectedId) || null
      : null
  }

  private ruleItemName (rule: SuperPresetRule): string {
    const isDevice = rule.trigger.kind === 'device'
    const targetId = isDevice ? rule.trigger.deviceUID : rule.trigger.bundleId
    const options = isDevice ? this.deviceOptions : this.appOptions
    const target = options.find(option => option.id === targetId)
    const targetName = target
      ? target.name
      : (targetId || this.translate.instant(isDevice ? 'superPresets.kinds.device' : 'superPresets.kinds.app'))
    const presetNameKey = `common.presetNames.${rule.presetId}`
    const presetName = this.translate.has(presetNameKey)
      ? this.translate.instant(presetNameKey)
      : rule.presetId
    return `${targetName} → ${presetName}`
  }

  // MARK: - Events

  private onRulesChangedCallback: SuperPresetsRulesChangedEventCallback
  private onEnabledChangedCallback: SuperPresetsEnabledChangedEventCallback

  protected setupEvents () {
    this.onRulesChangedCallback = rules => {
      if (!Array.isArray(rules)) return
      this.rules = rules
      // Device / app names may have changed alongside the rules -
      // refresh the options before rebuilding labels
      this.superPresets.getOptions()
        .then(options => {
          this.deviceOptions = ((options && options.devices) || []).map(device => ({ id: device.uid, name: device.name }))
          this.appOptions = ((options && options.apps) || []).map(mixerApp => ({ id: mixerApp.bundleId, name: mixerApp.name }))
        })
        .catch(() => {})
        .then(() => {
          this.buildRuleItems()
          this.detectChanges()
        })
    }
    this.superPresets.onRulesChanged(this.onRulesChangedCallback)

    this.onEnabledChangedCallback = data => {
      if (data && typeof data.enabled === 'boolean') {
        this.enabled = data.enabled
        this.detectChanges()
      }
    }
    this.superPresets.onEnabledChanged(this.onEnabledChangedCallback)
  }

  protected destroyEvents () {
    if (this.onRulesChangedCallback) {
      this.superPresets.offRulesChanged(this.onRulesChangedCallback)
    }
    if (this.onEnabledChangedCallback) {
      this.superPresets.offEnabledChanged(this.onEnabledChangedCallback)
    }
  }

  // MARK: - User actions

  setEnabled (enabled: boolean) {
    this.enabled = enabled
    this.superPresets.setEnabled(enabled)
  }

  selectRuleItem (item: SuperPresetRuleItem) {
    // Display-only selection - rules are edited through the dialog
    this.selectedRuleItem = item
  }

  async openDialog () {
    if (!this.available) return
    await this.dialog.open(SuperPresetsDialogComponent, {
      hasBackdrop: true,
      disableClose: false,
      width: '420px'
    }).afterClosed().toPromise()
    // The dialog suppresses its own /rules push echoes, so re-fetch to be
    // certain the bar reflects the final state after editing
    if (this.available) {
      await Promise.all([
        this.getEnabled(),
        this.fetchRulesAndOptions()
      ])
      this.detectChanges()
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
