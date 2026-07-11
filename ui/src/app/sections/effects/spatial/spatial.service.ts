import { Injectable } from '@angular/core'
import { EffectService } from '../effect.service'

/**
 * Matches the native ReverbEnvironment raw values exactly
 * (native/app/Source/Audio/Effects/Reverb/Reverb.swift)
 */
export const SpatialEnvironments = [
  'smallRoom',
  'mediumRoom',
  'largeRoom',
  'mediumHall',
  'largeHall',
  'plate',
  'mediumChamber',
  'largeChamber',
  'cathedral',
  'largeRoom2',
  'mediumHall2',
  'mediumHall3',
  'largeHall2'
] as const
export type SpatialEnvironment = typeof SpatialEnvironments[number]

export const SPATIAL_DEFAULT_ENVIRONMENT: SpatialEnvironment = 'mediumRoom'
export const SPATIAL_DEFAULT_WET_DRY_MIX = 25

@Injectable({
  providedIn: 'root'
})
export class SpatialService extends EffectService {
  route = `${this.route}/reverb`

  async getEnvironment (): Promise<SpatialEnvironment> {
    const { environment } = await this.request({ method: 'GET', endpoint: '/environment' })
    return environment
  }

  setEnvironment (environment: SpatialEnvironment) {
    return this.request({ method: 'POST', endpoint: '/environment', data: { environment } })
  }

  onEnvironmentChanged (callback: SpatialEnvironmentChangedEventCallback) {
    this.on('/environment', callback)
  }

  offEnvironmentChanged (callback: SpatialEnvironmentChangedEventCallback) {
    this.off('/environment', callback)
  }

  async getWetDryMix (): Promise<number> {
    const { wetDryMix } = await this.request({ method: 'GET', endpoint: '/wet-dry-mix' })
    return wetDryMix
  }

  setWetDryMix (wetDryMix: number) {
    return this.request({ method: 'POST', endpoint: '/wet-dry-mix', data: { wetDryMix } })
  }

  onWetDryMixChanged (callback: SpatialWetDryMixChangedEventCallback) {
    this.on('/wet-dry-mix', callback)
  }

  offWetDryMixChanged (callback: SpatialWetDryMixChangedEventCallback) {
    this.off('/wet-dry-mix', callback)
  }
}

export type SpatialEnvironmentChangedEventCallback = (data: { environment: SpatialEnvironment }) => void
export type SpatialWetDryMixChangedEventCallback = (data: { wetDryMix: number }) => void
