import { Injectable } from '@angular/core'
import { DataService } from '../../../services/data.service'

export const SuperPresetTriggerKinds = [ 'device', 'app' ] as const
export type SuperPresetTriggerKind = typeof SuperPresetTriggerKinds[number]

export const SuperPresetEqualizerTypes = [ 'Basic', 'Advanced', 'Expert', 'Graphic31' ] as const
export type SuperPresetEqualizerType = typeof SuperPresetEqualizerTypes[number]

export interface SuperPresetTrigger {
  kind: SuperPresetTriggerKind
  deviceUID?: string
  bundleId?: string
}

export interface SuperPresetRule {
  id?: string
  trigger: SuperPresetTrigger
  equalizerType: SuperPresetEqualizerType
  presetId: string
  revert: boolean
}

export interface SuperPresetsDeviceOption {
  uid: string
  name: string
}

export interface SuperPresetsAppOption {
  bundleId: string
  name: string
}

export interface SuperPresetsOptions {
  devices: SuperPresetsDeviceOption[]
  apps: SuperPresetsAppOption[]
}

@Injectable({
  providedIn: 'root'
})
export class SuperPresetsService extends DataService {
  route = `${this.route}/super-presets`

  async getEnabled (): Promise<boolean> {
    const resp = await this.request({ method: 'GET', endpoint: '/enabled' })
    return resp.enabled
  }

  setEnabled (enabled: boolean) {
    return this.request({ method: 'POST', endpoint: '/enabled', data: { enabled } })
  }

  getRules (): Promise<SuperPresetRule[]> {
    return this.request({ method: 'GET', endpoint: '/rules' })
  }

  /**
   * Creates the rule when its id is unknown to the native side,
   * updates it otherwise. Returns the saved rule (with its id).
   */
  upsertRule (rule: SuperPresetRule): Promise<SuperPresetRule> {
    return this.request({ method: 'POST', endpoint: '/rules', data: { ...rule } as any })
  }

  deleteRule (rule: SuperPresetRule) {
    return this.request({ method: 'DELETE', endpoint: '/rules', data: { id: rule.id } })
  }

  getOptions (): Promise<SuperPresetsOptions> {
    return this.request({ method: 'GET', endpoint: '/options' })
  }

  onRulesChanged (callback: SuperPresetsRulesChangedEventCallback) {
    this.on('/rules', callback)
  }

  offRulesChanged (callback: SuperPresetsRulesChangedEventCallback) {
    this.off('/rules', callback)
  }

  onEnabledChanged (callback: SuperPresetsEnabledChangedEventCallback) {
    this.on('/enabled', callback)
  }

  offEnabledChanged (callback: SuperPresetsEnabledChangedEventCallback) {
    this.off('/enabled', callback)
  }
}

export type SuperPresetsRulesChangedEventCallback = (rules: SuperPresetRule[]) => void
export type SuperPresetsEnabledChangedEventCallback = (data: { enabled: boolean }) => void
