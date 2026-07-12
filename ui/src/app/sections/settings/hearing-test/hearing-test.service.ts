import { Injectable } from '@angular/core'
import { DataService } from '../../../services/data.service'

export const HearingTestEars = [ 'left', 'right' ] as const
export type HearingTestEar = typeof HearingTestEars[number]

export interface HearingTestTone {
  frequency: number
  gainDb: number
  ear: HearingTestEar
}

export type HearingTestAbortedEventCallback = (data?: { aborted?: boolean }) => void

/**
 * Native contract (HearingTestDataBus, mounted at /hearing-test):
 *   GET  /session -> { active: boolean }
 *   POST /session { active } - while active, native remembers + disables the
 *        active Equalizer and restores it on deactivate / abort
 *   POST /tone { frequency: 20-20000, gainDb: -80..0, ear: 'left' | 'right' }
 *   POST /stop
 *   push /aborted { aborted: true } when the audio pipeline is torn down
 *        mid session (device / sample rate / EQ type change, eqMac disabled)
 */
@Injectable({
  providedIn: 'root'
})
export class HearingTestService extends DataService {
  route = '/hearing-test'

  async getSessionActive (): Promise<boolean> {
    const { active } = await this.request({ method: 'GET', endpoint: '/session' })
    return active
  }

  setSessionActive (active: boolean) {
    return this.request({ method: 'POST', endpoint: '/session', data: { active } })
  }

  startSession () {
    return this.setSessionActive(true)
  }

  endSession () {
    return this.setSessionActive(false)
  }

  playTone (tone: HearingTestTone) {
    return this.request({ method: 'POST', endpoint: '/tone', data: { ...tone } })
  }

  stopTone () {
    return this.request({ method: 'POST', endpoint: '/stop' })
  }

  onAborted (callback: HearingTestAbortedEventCallback) {
    this.on('/aborted', callback)
  }

  offAborted (callback: HearingTestAbortedEventCallback) {
    this.off('/aborted', callback)
  }
}
