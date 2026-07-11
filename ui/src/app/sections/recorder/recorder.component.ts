import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  HostBinding
} from '@angular/core'

import { ColorsService } from '@eqmac/components'
import { UtilitiesService } from '../../services/utilities.service'
import { ApplicationService } from '../../services/app.service'
import { SemanticVersion } from '../../services/semantic-version.service'
import {
  RecorderService,
  RecorderStatus,
  RecorderDestination,
  RecorderStatusChangedEventCallback
} from './recorder.service'

// First native version that ships the /recorder DataBus routes.
// Keep in sync with the actual release version of the Recorder native feature.
export const RECORDER_MIN_NATIVE_VERSION = '1.4.0'

@Component({
  selector: 'eqm-recorder',
  templateUrl: './recorder.component.html',
  styleUrls: [ './recorder.component.scss' ]
})
export class RecorderComponent implements OnInit, OnDestroy {
  minNativeVersion = RECORDER_MIN_NATIVE_VERSION

  available = false
  synced = false

  recording = false
  seconds = 0
  lastRecordingPath: string = null
  destination: RecorderDestination = null

  private toggling = false

  // Stable window-height participation - AppComponent polls and sums
  // section heights every second, so this must not jitter.
  @HostBinding('style.height.px') get height () {
    return 70
  }

  constructor (
    public recorderService: RecorderService,
    public app: ApplicationService,
    public utils: UtilitiesService,
    public colors: ColorsService,
    private readonly changeRef: ChangeDetectorRef
  ) {}

  ngOnInit () {
    this.sync()
  }

  async sync () {
    const { version } = await this.app.getInfo()
    this.available = new SemanticVersion(version)
      .isGreaterThanOrEqualTo(RECORDER_MIN_NATIVE_VERSION)
    if (this.available) {
      await Promise.all([
        this.getStatus(),
        this.getDestination()
      ])
      this.setupEvents()
    }
    this.synced = true
    this.detectChanges()
  }

  async getStatus () {
    const status = await this.recorderService.getStatus()
    this.applyStatus(status)
  }

  async getDestination () {
    this.destination = await this.recorderService.getDestination()
  }

  private onStatusChangedEventCallback: RecorderStatusChangedEventCallback

  protected setupEvents () {
    // Native pushes /status on start / stop transitions and at 1Hz while
    // recording - the stopwatch is fully driven by these pushes
    this.onStatusChangedEventCallback = status => {
      this.applyStatus(status)
      this.detectChanges()
    }
    this.recorderService.onStatusChanged(this.onStatusChangedEventCallback)
  }

  protected destroyEvents () {
    if (this.onStatusChangedEventCallback) {
      this.recorderService.offStatusChanged(this.onStatusChangedEventCallback)
    }
  }

  private applyStatus (status: RecorderStatus) {
    if (!status) return
    const wasRecording = this.recording
    this.recording = !!status.recording
    this.seconds = status.seconds || 0
    // Recording can also end natively (e.g. an unsupported sample rate
    // change) - keep the reveal button pointing at the finished file
    if (wasRecording && !this.recording && status.path) {
      this.lastRecordingPath = status.path
    }
  }

  async toggleRecording () {
    if (!this.available || this.toggling) return
    this.toggling = true
    try {
      if (this.recording) {
        const { path } = await this.recorderService.stop()
        this.recording = false
        if (path) {
          this.lastRecordingPath = path
        }
      } else {
        this.lastRecordingPath = null
        this.seconds = 0
        const status = await this.recorderService.start()
        this.recording = true
        this.applyStatus(status)
      }
    } catch (err) {
      // DataService already showed the error toast - just resync
      await this.getStatus().catch(() => {})
    } finally {
      this.toggling = false
      this.detectChanges()
    }
  }

  revealLastRecording () {
    if (!this.lastRecordingPath) return
    this.recorderService.reveal(this.lastRecordingPath)
  }

  async selectDestination () {
    if (!this.available) return
    this.destination = await this.recorderService.selectDestination()
    this.detectChanges()
  }

  async resetDestination () {
    if (!this.available) return
    this.destination = await this.recorderService.resetDestination()
    this.detectChanges()
  }

  get destinationFolderName () {
    const path = this.destination && this.destination.path
    if (!path) return 'eqMac Recordings'
    const parts = path.split('/').filter(part => !!part)
    return parts.length > 0 ? parts[parts.length - 1] : path
  }

  private destroyed = false
  private detectChanges () {
    if (!this.destroyed) {
      this.changeRef.detectChanges()
    }
  }

  ngOnDestroy () {
    this.destroyed = true
    this.destroyEvents()
  }
}
