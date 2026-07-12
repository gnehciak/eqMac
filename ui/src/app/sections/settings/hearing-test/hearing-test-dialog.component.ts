import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core'
import { MatDialog, MatDialogRef } from '@angular/material/dialog'
import {
  HearingTestService,
  HearingTestEar,
  HearingTestAbortedEventCallback
} from './hearing-test.service'
import {
  ExpertEqualizerService,
  ExpertEqualizerBand
} from '../../effects/equalizers/expert-equalizer/expert-equalizer.service'
import { AdvancedEqualizerService } from '../../effects/equalizers/advanced-equalizer/advanced-equalizer.service'
import { PromptDialogComponent } from '../../../components/prompt-dialog/prompt-dialog.component'
import { ToastService } from '../../../services/toast.service'
import { ApplicationService } from '../../../services/app.service'
import { SemanticVersion } from '../../../services/semantic-version.service'
import { TranslateService } from '../../../services/translate.service'

export const HEARING_TEST_MIN_NATIVE_VERSION = '1.4.0'

/** Test frequencies per ear (Hz) */
export const HEARING_TEST_FREQUENCIES = [ 250, 500, 1000, 2000, 3000, 4000, 6000, 8000, 12000 ]
export const HEARING_TEST_EARS: HearingTestEar[] = [ 'left', 'right' ]

/** Descending staircase parameters (levels in dBFS) */
export const HEARING_TEST_START_LEVEL = -50
export const HEARING_TEST_STEP_DOWN = 5
export const HEARING_TEST_STEP_UP = 3
export const HEARING_TEST_REVERSALS_NEEDED = 2
export const HEARING_TEST_MIN_LEVEL = -80
export const HEARING_TEST_MAX_LEVEL = 0

/** Compensation shaping */
export const HEARING_TEST_MAX_COMPENSATION_DB = 12
export const HEARING_TEST_EXPERT_Q = 1.4
export const HEARING_TEST_REFERENCE_FREQUENCY = 1000

/** Advanced (10 band) EQ center frequencies */
export const ADVANCED_EQ_FREQUENCIES = [ 32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 ]

type HearingTestStep = 'intro' | 'test' | 'results'
type StaircaseDirection = 'down' | 'up' | null

@Component({
  selector: 'eqm-hearing-test-dialog',
  templateUrl: './hearing-test-dialog.component.html',
  styleUrls: [ './hearing-test-dialog.component.scss' ]
})
export class HearingTestDialogComponent implements OnInit, OnDestroy {
  frequencies = HEARING_TEST_FREQUENCIES
  ears = HEARING_TEST_EARS

  step: HearingTestStep = 'intro'
  loaded = false
  available = false
  minNativeVersion = HEARING_TEST_MIN_NATIVE_VERSION

  sessionActive = false
  wasAborted = false

  // Staircase state
  earIndex = 0
  freqIndex = 0
  level = HEARING_TEST_START_LEVEL
  private lastDirection: StaircaseDirection = null
  private reversalLevels: number[] = []
  toneStarted = false
  private pauseTimer: any = null

  thresholds: Record<HearingTestEar, Record<number, number>> = { left: {}, right: {} }

  // Results
  resultBands: ExpertEqualizerBand[] = []
  advancedGains: number[] = []
  isFlat = false
  saving = false

  constructor (
    public dialogRef: MatDialogRef<HearingTestDialogComponent>,
    public service: HearingTestService,
    public expertService: ExpertEqualizerService,
    public advancedService: AdvancedEqualizerService,
    public app: ApplicationService,
    public dialog: MatDialog,
    public toast: ToastService,
    private readonly translate: TranslateService,
    private readonly changeRef: ChangeDetectorRef
  ) {}

  ngOnInit () {
    this.service.onAborted(this.onAborted)
    this.sync()
  }

  ngOnDestroy () {
    this.service.offAborted(this.onAborted)
    this.clearPauseTimer()
    if (this.sessionActive) {
      this.sessionActive = false
      // Fire and forget - restores the Equalizer enabled state natively
      this.service.stopTone().catch(() => {})
      this.service.endSession().catch(() => {})
    }
  }

  async sync () {
    try {
      const { version } = await this.app.getInfo()
      this.available = new SemanticVersion(version).isGreaterThanOrEqualTo(HEARING_TEST_MIN_NATIVE_VERSION)
    } catch (err) {
      this.available = false
    }
    this.loaded = true
    this.changeRef.detectChanges()
  }

  private readonly onAborted: HearingTestAbortedEventCallback = () => {
    this.sessionActive = false
    this.clearPauseTimer()
    if (this.step === 'test') {
      this.wasAborted = true
      this.step = 'intro'
      this.toast.show({
        message: this.translate.instant('hearingTest.interrupted'),
        type: 'warning'
      })
    }
    this.changeRef.detectChanges()
  }

  // MARK: - Wizard flow

  async start () {
    if (!this.available || this.sessionActive) return
    try {
      await this.service.startSession()
    } catch (err) {
      // DataService already showed the error toast
      return
    }
    this.sessionActive = true
    this.wasAborted = false
    this.step = 'test'
    this.earIndex = 0
    this.freqIndex = 0
    this.thresholds = { left: {}, right: {} }
    this.changeRef.detectChanges()
    this.beginStaircase()
  }

  async cancelTest () {
    this.clearPauseTimer()
    this.step = 'intro'
    if (this.sessionActive) {
      this.sessionActive = false
      try {
        await this.service.stopTone()
        await this.service.endSession()
      } catch (err) {}
    }
    this.changeRef.detectChanges()
  }

  close () {
    this.dialogRef.close()
  }

  // MARK: - Staircase

  get currentEar (): HearingTestEar {
    return this.ears[this.earIndex] || 'left'
  }

  get currentFrequency (): number {
    return this.frequencies[this.freqIndex] || HEARING_TEST_REFERENCE_FREQUENCY
  }

  get currentFrequencyLabel (): string {
    return HearingTestDialogComponent.frequencyLabel(this.currentFrequency)
  }

  static frequencyLabel (frequency: number): string {
    return frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`
  }

  get progressFraction (): number {
    const total = this.ears.length * this.frequencies.length
    const done = this.earIndex * this.frequencies.length + this.freqIndex
    return total > 0 ? done / total : 0
  }

  get progressLabel (): string {
    return this.translate.instant(
      this.currentEar === 'left' ? 'hearingTest.progressLeft' : 'hearingTest.progressRight',
      { current: this.freqIndex + 1, total: this.frequencies.length }
    )
  }

  private beginStaircase () {
    this.level = HEARING_TEST_START_LEVEL
    this.lastDirection = null
    this.reversalLevels = []
    this.toneStarted = false
    this.service.stopTone().catch(() => {})
    this.clearPauseTimer()
    // Short silent gap between frequencies so each tone has a clear onset
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null
      this.playCurrent()
    }, 500)
    this.changeRef.detectChanges()
  }

  private async playCurrent () {
    if (this.step !== 'test' || !this.sessionActive) return
    try {
      await this.service.playTone({
        frequency: this.currentFrequency,
        gainDb: this.level,
        ear: this.currentEar
      })
      this.toneStarted = true
    } catch (err) {
      // DataService already showed the error toast; the native /aborted
      // push handles pipeline teardown
    }
    this.changeRef.detectChanges()
  }

  heard () {
    if (!this.toneStarted || this.step !== 'test') return
    this.toneStarted = false
    if (this.lastDirection === 'up') {
      this.reversalLevels.push(this.level)
      if (this.reversalLevels.length >= HEARING_TEST_REVERSALS_NEEDED) {
        return this.completeFrequency()
      }
    }
    this.lastDirection = 'down'
    if (this.level <= HEARING_TEST_MIN_LEVEL) {
      // Heard the quietest tone we can render
      return this.completeFrequency(HEARING_TEST_MIN_LEVEL)
    }
    this.level = Math.max(this.level - HEARING_TEST_STEP_DOWN, HEARING_TEST_MIN_LEVEL)
    this.playCurrent()
  }

  notHeard () {
    if (!this.toneStarted || this.step !== 'test') return
    this.toneStarted = false
    if (this.lastDirection === 'down') {
      this.reversalLevels.push(this.level)
      if (this.reversalLevels.length >= HEARING_TEST_REVERSALS_NEEDED) {
        return this.completeFrequency()
      }
    }
    this.lastDirection = 'up'
    if (this.level >= HEARING_TEST_MAX_LEVEL) {
      // Cannot go louder than full scale - record the ceiling
      return this.completeFrequency(HEARING_TEST_MAX_LEVEL)
    }
    this.level = Math.min(this.level + HEARING_TEST_STEP_UP, HEARING_TEST_MAX_LEVEL)
    this.playCurrent()
  }

  private completeFrequency (forcedThreshold?: number) {
    const threshold = typeof forcedThreshold === 'number'
      ? forcedThreshold
      : this.reversalLevels.reduce((sum, level) => sum + level, 0) / this.reversalLevels.length
    this.thresholds[this.currentEar][this.currentFrequency] = Math.round(threshold * 10) / 10

    this.freqIndex += 1
    if (this.freqIndex >= this.frequencies.length) {
      this.freqIndex = 0
      this.earIndex += 1
    }
    if (this.earIndex >= this.ears.length) {
      this.showResults()
    } else {
      this.beginStaircase()
    }
  }

  private async showResults () {
    this.clearPauseTimer()
    this.step = 'results'
    this.computeResults()
    this.changeRef.detectChanges()
    if (this.sessionActive) {
      this.sessionActive = false
      try {
        await this.service.stopTone()
        // Ends the session BEFORE any preset save so the Equalizer enabled
        // state is restored and preset selection can't race the session
        await this.service.endSession()
      } catch (err) {}
    }
    this.changeRef.detectChanges()
  }

  // MARK: - Compensation math

  /**
   * Compensation per test frequency for one ear:
   * threshold relative to that ear's 1 kHz threshold, clamped to
   * ±HEARING_TEST_MAX_COMPENSATION_DB, then smoothed with adjacent band
   * averaging (0.25 / 0.5 / 0.25).
   */
  compensationForEar (ear: HearingTestEar): number[] {
    const earThresholds = this.thresholds[ear] || {}
    const reference = typeof earThresholds[HEARING_TEST_REFERENCE_FREQUENCY] === 'number'
      ? earThresholds[HEARING_TEST_REFERENCE_FREQUENCY]
      : HEARING_TEST_START_LEVEL
    const raw = this.frequencies.map(frequency => {
      const threshold = typeof earThresholds[frequency] === 'number'
        ? earThresholds[frequency]
        : reference
      const compensation = threshold - reference
      return Math.max(
        -HEARING_TEST_MAX_COMPENSATION_DB,
        Math.min(HEARING_TEST_MAX_COMPENSATION_DB, compensation)
      )
    })
    return raw.map((value, index) => {
      const previous = index > 0 ? raw[index - 1] : value
      const next = index < raw.length - 1 ? raw[index + 1] : value
      return Math.round(((previous + 2 * value + next) / 4) * 10) / 10
    })
  }

  private computeResults () {
    const bands: ExpertEqualizerBand[] = []
    for (const ear of this.ears) {
      const compensation = this.compensationForEar(ear)
      this.frequencies.forEach((frequency, index) => {
        bands.push({
          id: `hearing-${ear}-${frequency}`,
          type: 'peak',
          frequency,
          gain: compensation[index],
          q: HEARING_TEST_EXPERT_Q,
          channel: ear,
          enabled: true
        })
      })
    }
    this.resultBands = bands
    this.isFlat = bands.every(band => Math.abs(band.gain) < 0.5)

    // Both-channel 10 band approximation: mean of both ears' compensation,
    // log-interpolated onto the Advanced EQ center frequencies
    const left = this.compensationForEar('left')
    const right = this.compensationForEar('right')
    const mean = left.map((value, index) => (value + right[index]) / 2)
    this.advancedGains = ADVANCED_EQ_FREQUENCIES.map(frequency =>
      Math.round(this.logInterpolate(this.frequencies, mean, frequency) * 10) / 10
    )
  }

  private logInterpolate (frequencies: number[], values: number[], target: number): number {
    if (!frequencies.length) return 0
    if (target <= frequencies[0]) return values[0]
    const last = frequencies.length - 1
    if (target >= frequencies[last]) return values[last]
    for (let index = 0; index < last; index++) {
      const lower = frequencies[index]
      const upper = frequencies[index + 1]
      if (target >= lower && target <= upper) {
        const t = (Math.log(target) - Math.log(lower)) / (Math.log(upper) - Math.log(lower))
        return values[index] + (values[index + 1] - values[index]) * t
      }
    }
    return values[last]
  }

  // MARK: - Saving

  private defaultPresetName () {
    return this.translate.instant('hearingTest.defaultPresetName', {
      date: new Date().toLocaleDateString()
    })
  }

  private async promptName (): Promise<string | undefined> {
    return this.dialog.open(PromptDialogComponent, {
      hasBackdrop: true,
      disableClose: true,
      data: {
        confirmText: this.translate.instant('presets.save'),
        cancelText: this.translate.instant('presets.cancel'),
        text: this.translate.instant('hearingTest.enterPresetName'),
        placeholder: this.translate.instant('presets.newPresetName'),
        prompt: this.defaultPresetName()
      }
    }).afterClosed().toPromise()
  }

  /**
   * Expert preset: per ear channel specific peak bands (q 1.4), gains are
   * the clamped ±12 dB compensation relative to that ear's 1 kHz threshold
   */
  async saveExpertPreset () {
    if (this.saving) return
    const name = await this.promptName()
    if (!name) return
    this.saving = true
    this.changeRef.detectChanges()
    try {
      const bands = this.resultBands.filter(band => Math.abs(band.gain) >= 0.1)
      await this.expertService.createPreset({ name, bands, globalGain: 0 })
      this.toast.show({
        message: this.translate.instant('hearingTest.savedExpert'),
        type: 'success',
        duration: 4000
      })
    } catch (err) {
      // DataService already showed the error toast
    } finally {
      this.saving = false
      this.changeRef.detectChanges()
    }
  }

  /**
   * Advanced preset: both-channel 10 band approximation of the mean
   * compensation curve (log-interpolated onto the Advanced EQ frequencies)
   */
  async saveAdvancedPreset () {
    if (this.saving) return
    const name = await this.promptName()
    if (!name) return
    this.saving = true
    this.changeRef.detectChanges()
    try {
      await this.advancedService.createPreset({
        name,
        gains: {
          global: 0,
          bands: this.advancedGains
        }
      })
      this.toast.show({
        message: this.translate.instant('hearingTest.savedAdvanced'),
        type: 'success',
        duration: 4000
      })
    } catch (err) {
      // DataService already showed the error toast
    } finally {
      this.saving = false
      this.changeRef.detectChanges()
    }
  }

  private clearPauseTimer () {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
  }
}
