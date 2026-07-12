import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  Inject,
  Optional
} from '@angular/core'
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog'
import { Subscription } from 'rxjs'
import { UIService, UISettings } from '../../../services/ui.service'
import { TranslateService } from '../../../services/translate.service'

// UISettings keys this dialog reads / writes inside the existing opaque JSON
// blob (native side merges partial POSTs - zero native change needed).
// The volume / balance / equalizers / output flags are the same ones
// SettingsComponent.hideShowFeaturesOption toggles; the rest are the wave-2
// section flags (defaulted true by their owning sections / UIService.sync).
export interface ArrangementUISettings extends UISettings {
  sectionOrder?: string[]
  appMixerFeatureEnabled?: boolean
  effectsFeatureEnabled?: boolean
  spatialFeatureEnabled?: boolean
  audioUnitsFeatureEnabled?: boolean
  recorderFeatureEnabled?: boolean
}

export type SectionFeatureFlag =
  'volumeFeatureEnabled' |
  'appMixerFeatureEnabled' |
  'equalizersFeatureEnabled' |
  'effectsFeatureEnabled' |
  'spatialFeatureEnabled' |
  'audioUnitsFeatureEnabled' |
  'recorderFeatureEnabled' |
  'outputFeatureEnabled'

export interface SectionDefinition {
  id: string
  // English fallback label — templates should render labelKey | translate
  label: string
  // i18n catalog key for the display label (sections.*)
  labelKey: string
  flag: SectionFeatureFlag
}

// Main window sections in their default (current hardcoded) order.
// ids are the cross-package section identifiers persisted in
// UISettings.sectionOrder and consumed by AppComponent (integration).
export const SECTION_DEFINITIONS: SectionDefinition[] = [
  { id: 'volume', label: 'Volume', labelKey: 'sections.volume', flag: 'volumeFeatureEnabled' },
  { id: 'app-mixer', label: 'App Mixer', labelKey: 'sections.appMixer', flag: 'appMixerFeatureEnabled' },
  { id: 'equalizers', label: 'Equalizers', labelKey: 'sections.equalizers', flag: 'equalizersFeatureEnabled' },
  { id: 'effects', label: 'Effects', labelKey: 'sections.effects', flag: 'effectsFeatureEnabled' },
  { id: 'spatial', label: 'Spatial Audio', labelKey: 'sections.spatial', flag: 'spatialFeatureEnabled' },
  { id: 'audio-units', label: 'Audio Units', labelKey: 'sections.audioUnits', flag: 'audioUnitsFeatureEnabled' },
  { id: 'recorder', label: 'Recorder', labelKey: 'sections.recorder', flag: 'recorderFeatureEnabled' },
  { id: 'outputs', label: 'Output', labelKey: 'sections.output', flag: 'outputFeatureEnabled' }
]

export const DEFAULT_SECTION_ORDER: string[] = SECTION_DEFINITIONS.map(section => section.id)

/**
 * Normalizes a persisted section order: keeps only known section ids,
 * drops duplicates and appends any missing sections in default order.
 * AppComponent (integration) should run persisted UISettings.sectionOrder
 * through this exact helper before rendering.
 */
export function normalizeSectionOrder (persisted?: string[]): string[] {
  const seen: { [id: string]: boolean } = {}
  const order: string[] = []
  for (const id of Array.isArray(persisted) ? persisted : []) {
    if (DEFAULT_SECTION_ORDER.indexOf(id) >= 0 && !seen[id]) {
      seen[id] = true
      order.push(id)
    }
  }
  for (const id of DEFAULT_SECTION_ORDER) {
    if (!seen[id]) {
      seen[id] = true
      order.push(id)
    }
  }
  return order
}

export interface ArrangementDialogData {
  title?: string
}

interface SectionRow extends SectionDefinition {
  enabled: boolean
}

@Component({
  selector: 'eqm-arrangement-dialog',
  templateUrl: './arrangement-dialog.component.html',
  styles: [ `
    .arrangement-dialog {
      min-width: 300px;
      max-width: 400px;
    }
    .arrangement-dialog .hint {
      opacity: 0.7;
    }
    .arrangement-dialog .clickable {
      cursor: pointer;
    }
    .arrangement-dialog .section-row {
      border: 1px solid var(--eqm-gradient-end, #2c2c2e);
      border-radius: 6px;
      padding: 6px 8px;
    }
    .arrangement-dialog .sub-row {
      margin-left: 24px;
      padding: 0 8px;
    }
    .arrangement-dialog .row-button {
      cursor: pointer;
      flex-shrink: 0;
    }
    .arrangement-dialog .row-button.disabled {
      opacity: 0.3;
      pointer-events: none;
    }
  ` ]
})
export class ArrangementDialogComponent implements OnInit, OnDestroy {
  title = ''

  synced = false
  rows: SectionRow[] = []
  balanceEnabled = true

  // Suppresses the settingsChanged echo triggered by our own writes
  private ignoreUpdates = false
  private ignoreUpdatesTimer: any

  private settingsChangedSubscription: Subscription
  private destroyed = false

  constructor (
    public ui: UIService,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef,
    public dialogRef: MatDialogRef<ArrangementDialogComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data: ArrangementDialogData
  ) {
    this.title = this.translate.instant('settings.arrangeFeatures')
    if (this.data && this.data.title) {
      this.title = this.data.title
    }
  }

  ngOnInit () {
    this.sync()
  }

  async sync () {
    const settings = await this.ui.getSettings() as ArrangementUISettings
    this.applySettings(settings)
    this.synced = true
    this.detectChanges()

    this.settingsChangedSubscription = this.ui.settingsChanged.subscribe(changed => {
      if (this.ignoreUpdates) return
      this.applySettings(changed as ArrangementUISettings)
      this.detectChanges()
    })
  }

  private applySettings (settings: ArrangementUISettings) {
    const order = normalizeSectionOrder(settings.sectionOrder)
    this.rows = order.map(id => {
      const section = SECTION_DEFINITIONS.find(definition => definition.id === id)
      return {
        ...section,
        enabled: settings[section.flag] ?? true
      }
    })
    this.balanceEnabled = settings.balanceFeatureEnabled ?? true
  }

  trackRow (index: number, row: SectionRow) {
    return row.id
  }

  // MARK: - User actions

  move (row: SectionRow, direction: -1 | 1) {
    const index = this.rows.indexOf(row)
    const target = index + direction
    if (index < 0 || target < 0 || target >= this.rows.length) return
    this.rows[index] = this.rows[target]
    this.rows[target] = row
    this.detectChanges()
    this.persist({ sectionOrder: this.rows.map(sectionRow => sectionRow.id) })
  }

  setSectionEnabled (row: SectionRow, enabled: boolean) {
    row.enabled = enabled
    this.detectChanges()
    this.persist({ [row.flag]: enabled } as Partial<ArrangementUISettings>)
  }

  toggleSection (row: SectionRow) {
    this.setSectionEnabled(row, !row.enabled)
  }

  toggleBalance () {
    this.balanceEnabled = !this.balanceEnabled
    this.detectChanges()
    this.persist({ balanceFeatureEnabled: this.balanceEnabled })
  }

  close () {
    this.dialogRef.close()
  }

  private persist (patch: Partial<ArrangementUISettings>) {
    this.suppressUpdates()
    this.ui.setSettings(patch).catch(() => {})
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

  private detectChanges () {
    if (!this.destroyed) {
      this.changeRef.detectChanges()
    }
  }

  ngOnDestroy () {
    this.destroyed = true
    if (this.ignoreUpdatesTimer) {
      clearTimeout(this.ignoreUpdatesTimer)
    }
    if (this.settingsChangedSubscription) {
      this.settingsChangedSubscription.unsubscribe()
    }
  }
}
