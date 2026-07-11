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
  rows: HotkeyRow[] = [
    { action: 'volumeUp', label: 'Volume Up' },
    { action: 'volumeDown', label: 'Volume Down' },
    { action: 'muteToggle', label: 'Mute / Unmute' },
    { action: 'boostToggle', label: 'Volume Boost On / Off' },
    { action: 'nextPreset', label: 'Next Preset' },
    { action: 'previousPreset', label: 'Previous Preset' },
    { action: 'eqMacEnabledToggle', label: 'Enable / Disable eqMac' },
    { action: 'showHideWindow', label: 'Show / Hide Window' }
  ]

  bindings: HotkeyBindings = {}
  recording: HotkeyAction | null = null
  available = false
  loaded = false
  minNativeVersion = HOTKEYS_MIN_NATIVE_VERSION

  constructor (
    public dialogRef: MatDialogRef<HotkeysDialogComponent>,
    public hotkeysService: HotkeysService,
    public app: ApplicationService,
    private readonly changeRef: ChangeDetectorRef
  ) {}

  ngOnInit () {
    this.sync()
  }

  ngOnDestroy () {
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
    if (this.recording === row.action) return 'Listening…'
    return this.bindings[row.action] ? 'Change' : 'Record'
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
