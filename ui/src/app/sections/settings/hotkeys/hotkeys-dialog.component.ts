import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core'
import { MatDialogRef } from '@angular/material/dialog'
import {
  HotkeysService,
  HotkeyAction,
  HotkeyBindings,
  HotkeyBindingsChangedEventCallback
} from './hotkeys.service'
import { ApplicationService } from '../../../services/app.service'
import { SemanticVersion } from '../../../services/semantic-version.service'
import { TranslateService } from '../../../services/translate.service'
import { Subscription } from 'rxjs'

export const HOTKEYS_MIN_NATIVE_VERSION = '1.4.0'

export interface HotkeyRow {
  action: HotkeyAction
  label: string
}

@Component({
  selector: 'eqm-hotkeys-dialog',
  templateUrl: './hotkeys-dialog.component.html',
  styles: [ `
    :host {
      display: block;
      min-width: 400px;
    }
    .title {
      margin-bottom: 10px;
    }
    .hotkey-row {
      padding: 2px 0;
      min-height: 24px;
    }
    .combo {
      white-space: nowrap;
      color: var(--eqm-accent, #4f8d71);
    }
    .combo.not-set {
      opacity: 0.5;
      color: var(--eqm-text-light, #c9cdd0);
    }
    .clear-button {
      cursor: pointer;
      flex-shrink: 0;
    }
    .clear-placeholder {
      width: 14px;
      flex-shrink: 0;
    }
    .hint {
      opacity: 0.6;
      margin-top: 6px;
    }
  ` ]
})
export class HotkeysDialogComponent implements OnInit, OnDestroy {
  // Labels come from the i18n catalog (hotkeys.actions.*) — retranslated
  // in place on locale change so row identity is preserved
  rows: HotkeyRow[] = [
    { action: 'volumeUp', label: '' },
    { action: 'volumeDown', label: '' },
    { action: 'muteToggle', label: '' },
    { action: 'boostToggle', label: '' },
    { action: 'nextPreset', label: '' },
    { action: 'previousPreset', label: '' },
    { action: 'eqMacEnabledToggle', label: '' },
    { action: 'showHideWindow', label: '' }
  ]

  private applyTranslations () {
    for (const row of this.rows) {
      row.label = this.translate.instant(`hotkeys.actions.${row.action}`)
    }
  }

  bindings: HotkeyBindings = {}
  recording: HotkeyAction | null = null
  available = false
  loaded = false
  minNativeVersion = HOTKEYS_MIN_NATIVE_VERSION

  constructor (
    public dialogRef: MatDialogRef<HotkeysDialogComponent>,
    public hotkeysService: HotkeysService,
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
      this.changeRef.detectChanges()
    })
    this.sync()
  }

  ngOnDestroy () {
    this.localeChangedSubscription?.unsubscribe()
    this.hotkeysService.offBindingsChanged(this.onBindingsChanged)
  }

  private readonly onBindingsChanged: HotkeyBindingsChangedEventCallback = ({ bindings }) => {
    this.bindings = bindings || {}
    this.changeRef.detectChanges()
  }

  async sync () {
    const { version } = await this.app.getInfo()
    this.available = new SemanticVersion(version).isGreaterThanOrEqualTo(HOTKEYS_MIN_NATIVE_VERSION)
    if (this.available) {
      this.bindings = await this.hotkeysService.getBindings()
      this.hotkeysService.onBindingsChanged(this.onBindingsChanged)
    }
    this.loaded = true
    this.changeRef.detectChanges()
  }

  displayFor (action: HotkeyAction) {
    const binding = this.bindings[action]
    return (binding && binding.display) || ''
  }

  recordButtonLabel (row: HotkeyRow) {
    if (this.recording === row.action) return this.translate.instant('common.listening')
    return this.translate.instant(this.bindings[row.action] ? 'hotkeys.change' : 'hotkeys.record')
  }

  async record (row: HotkeyRow) {
    if (this.recording || !this.available) return
    this.recording = row.action
    this.changeRef.detectChanges()
    try {
      const result = await this.hotkeysService.capture(row.action)
      if (result && !result.cancelled && typeof result.keyCode === 'number' && typeof result.modifiers === 'number') {
        await this.hotkeysService.setBinding(row.action, {
          keyCode: result.keyCode,
          modifiers: result.modifiers,
          enabled: true
        })
        this.bindings = {
          ...this.bindings,
          [row.action]: {
            keyCode: result.keyCode,
            modifiers: result.modifiers,
            enabled: true,
            display: result.display
          }
        }
      }
    } finally {
      this.recording = null
      this.changeRef.detectChanges()
    }
  }

  async setEnabled (row: HotkeyRow, enabled: boolean) {
    const binding = this.bindings[row.action]
    if (!binding) return
    await this.hotkeysService.setBinding(row.action, {
      keyCode: binding.keyCode,
      modifiers: binding.modifiers,
      enabled
    })
    this.bindings = {
      ...this.bindings,
      [row.action]: { ...binding, enabled }
    }
    this.changeRef.detectChanges()
  }

  async clear (row: HotkeyRow) {
    if (!this.bindings[row.action] || this.recording === row.action) return
    await this.hotkeysService.deleteBinding(row.action)
    const bindings = { ...this.bindings }
    delete bindings[row.action]
    this.bindings = bindings
    this.changeRef.detectChanges()
  }

  close () {
    this.dialogRef.close()
  }
}
