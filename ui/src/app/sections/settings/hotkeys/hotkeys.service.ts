import { Injectable } from '@angular/core'
import { DataService } from 'src/app/services/data.service'

// Must match HotkeyAction raw values in
// native/app/Source/Hotkeys/HotkeysState.swift
export const HotkeyActions = [
  'volumeUp',
  'volumeDown',
  'muteToggle',
  'boostToggle',
  'nextPreset',
  'previousPreset',
  'eqMacEnabledToggle',
  'showHideWindow'
] as const
export type HotkeyAction = typeof HotkeyActions[number]

export interface HotkeyBinding {
  keyCode: number
  // Carbon modifier flags mask (⌘ 256, ⇧ 512, ⌥ 2048, ⌃ 4096)
  modifiers: number
  enabled: boolean
  // Human readable combo rendered natively via UCKeyTranslate, e.g. "⌃⌥⇧⌘F1"
  display?: string
}

export type HotkeyBindings = {
  [action in HotkeyAction]?: HotkeyBinding
}

export interface HotkeyCaptureResult {
  keyCode?: number
  modifiers?: number
  display?: string
  cancelled?: boolean
}

@Injectable({
  providedIn: 'root'
})
export class HotkeysService extends DataService {
  route = `${this.route}/hotkeys`

  async getBindings (): Promise<HotkeyBindings> {
    const resp = await this.request({ method: 'GET', endpoint: '/bindings' })
    return (resp && resp.bindings) || {}
  }

  setBinding (action: HotkeyAction, binding: { keyCode: number, modifiers: number, enabled?: boolean }) {
    return this.request({
      method: 'POST',
      endpoint: '/bindings',
      data: {
        action,
        keyCode: binding.keyCode,
        modifiers: binding.modifiers,
        enabled: binding.enabled ?? true
      }
    })
  }

  deleteBinding (action: HotkeyAction) {
    return this.request({ method: 'DELETE', endpoint: '/bindings', data: { action } })
  }

  /**
   * Arms the native in-app key capture (transient local key monitor).
   * Resolves with the captured combo once the user presses one, or with
   * { cancelled: true } on Escape / timeout. Does NOT save the binding -
   * follow up with setBinding.
   */
  capture (action: HotkeyAction): Promise<HotkeyCaptureResult> {
    return this.request({ method: 'POST', endpoint: '/capture', data: { action } })
  }

  onBindingsChanged (callback: HotkeyBindingsChangedEventCallback) {
    this.on('/bindings', callback)
  }

  offBindingsChanged (callback: HotkeyBindingsChangedEventCallback) {
    this.off('/bindings', callback)
  }
}

export type HotkeyBindingsChangedEventCallback = (data: { bindings: HotkeyBindings }) => void
