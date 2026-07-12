import {
  Component,
  OnInit,
  ViewChild,
  AfterContentInit,
  HostListener
} from '@angular/core'
import { UtilitiesService } from './services/utilities.service'
import { UIService } from './services/ui.service'
import { FadeInOutAnimation, FromTopAnimation } from '@eqmac/components'
import { MatDialog, MatDialogRef } from '@angular/material/dialog'
import { TransitionService } from './services/transitions.service'
import { AnalyticsService } from './services/analytics.service'
import { ApplicationService } from './services/app.service'
import { SettingsService, IconMode } from './sections/settings/settings.service'
import { ToastService } from './services/toast.service'
import { OptionsDialogComponent } from './components/options-dialog/options-dialog.component'
import { Option, Options } from './components/options/options.component'
import { HeaderComponent } from './sections/header/header.component'
import { VolumeBoosterBalanceComponent } from './sections/volume/booster-balance/volume-booster-balance.component'
import { EqualizersComponent } from './sections/effects/equalizers/equalizers.component'
import { OutputsComponent } from './sections/outputs/outputs.component'
import { AppMixerComponent } from './sections/app-mixer/app-mixer.component'
import { AudioEffectsComponent } from './sections/effects/audio-effects/audio-effects.component'
import { SpatialComponent } from './sections/effects/spatial/spatial.component'
import { AudioUnitsComponent } from './sections/effects/audio-units/audio-units.component'
import { RecorderComponent } from './sections/recorder/recorder.component'
import { normalizeSectionOrder } from './sections/settings/themes/arrangement-dialog.component'
import { ThemeService } from './services/theme.service'
import { TranslateService } from './services/translate.service'

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [ './app.component.scss' ],
  animations: [ FadeInOutAnimation, FromTopAnimation ]
})

export class AppComponent implements OnInit, AfterContentInit {
  @ViewChild('container', { static: true }) container
  @ViewChild('header', { static: true }) header: HeaderComponent
  @ViewChild('volumeBoosterBalance', { static: false }) volumeBoosterBalance: VolumeBoosterBalanceComponent
  @ViewChild('equalizers', { static: false }) equalizers: EqualizersComponent
  @ViewChild('outputs', { static: false }) outputs: OutputsComponent
  @ViewChild('appMixer', { static: false }) appMixer: AppMixerComponent
  @ViewChild('audioEffects', { static: false }) audioEffects: AudioEffectsComponent
  @ViewChild('spatial', { static: false }) spatial: SpatialComponent
  @ViewChild('audioUnits', { static: false }) audioUnits: AudioUnitsComponent
  @ViewChild('recorder', { static: false }) recorder: RecorderComponent

  // Main-section rendering order (Arrangement dialog persists
  // UISettings.sectionOrder; normalizeSectionOrder always returns all
  // known section ids, appending missing ones in default order)
  get sectionOrder (): string[] {
    return normalizeSectionOrder(this.ui.settings.sectionOrder)
  }

  isLastSection (sectionId: string): boolean {
    const order = this.sectionOrder
    return order[order.length - 1] === sectionId
  }

  loaded = false
  animationDuration = 500
  animationFps = 30

  showDropdownSections = {
    settings: false,
    help: false
  }

  private containerWidth = 400
  private containerHeight = 400
  get containerStyle () {
    const style: any = {}

    style.width = `${this.containerWidth / this.ui.scale}px`
    style.height = `${this.containerHeight / this.ui.scale}px`
    style.transform = `scale(${this.ui.scale})`

    const cdkOverlays = document.getElementsByClassName('cdk-overlay-pane')
    for (let i = 0; i < cdkOverlays.length; i++) {
      cdkOverlays[i].setAttribute('style', `transform: scale(${this.ui.scale.toFixed(2)}); width: ${Math.round(90 / this.ui.scale)}vw`)
    }
    return style
  }

  constructor (
    public utils: UtilitiesService,
    public ui: UIService,
    public dialog: MatDialog,
    public transitions: TransitionService,
    public analytics: AnalyticsService,
    public app: ApplicationService,
    public settings: SettingsService,
    public toast: ToastService,
    // Injected so they self-initialize on boot: ThemeService stamps the
    // persisted theme tokens, TranslateService restores the saved locale
    public theme: ThemeService,
    public translate: TranslateService
  ) {
    this.app.ref = this
  }

  // Sums the heights of all enabled + rendered main sections. Every
  // section except the last rendered one is followed by an eqm-divider.
  // ViewChild refs are null-guarded: right after a visibility toggle a
  // ref can be undefined for one CD cycle and the 1s dimensions poll
  // must not throw.
  private sectionsHeight ({ useEqualizersMaxHeight }: { useEqualizersMaxHeight: boolean }): number {
    const divider = 3

    const {
      volumeFeatureEnabled, balanceFeatureEnabled,
      appMixerFeatureEnabled,
      equalizersFeatureEnabled,
      effectsFeatureEnabled,
      spatialFeatureEnabled,
      audioUnitsFeatureEnabled,
      recorderFeatureEnabled,
      outputFeatureEnabled
    } = this.ui.settings

    const heights: number[] = []
    if ((volumeFeatureEnabled || balanceFeatureEnabled) && this.volumeBoosterBalance) {
      heights.push(this.volumeBoosterBalance.height)
    }
    if (appMixerFeatureEnabled && this.appMixer) {
      heights.push(this.appMixer.height)
    }
    if (equalizersFeatureEnabled && this.equalizers) {
      heights.push(useEqualizersMaxHeight ? this.equalizers.maxHeight : this.equalizers.height)
    }
    if (effectsFeatureEnabled && this.audioEffects) {
      heights.push(this.audioEffects.height)
    }
    if (spatialFeatureEnabled && this.spatial) {
      heights.push(this.spatial.height)
    }
    if (audioUnitsFeatureEnabled && this.audioUnits) {
      heights.push(this.audioUnits.height)
    }
    if (recorderFeatureEnabled && this.recorder) {
      heights.push(this.recorder.height)
    }
    if (outputFeatureEnabled && this.outputs) {
      heights.push(this.outputs.height)
    }

    return heights.reduce((sum, height) => sum + height, 0) +
      Math.max(heights.length - 1, 0) * divider
  }

  get minHeight () {
    const divider = 3

    let minHeight = this.header.height + divider +
      this.sectionsHeight({ useEqualizersMaxHeight: false })

    const dropdownSection = document.getElementById('dropdown-section')
    if (dropdownSection) {
      const dropdownHeight = dropdownSection.offsetHeight + this.header.height + divider
      if (dropdownHeight > minHeight) {
        minHeight = dropdownHeight
      }
    }

    return minHeight
  }

  get minWidth () {
    return 400
  }

  get maxHeight () {
    const divider = 3

    let maxHeight = this.header.height + divider +
      this.sectionsHeight({ useEqualizersMaxHeight: true })

    const dropdownSection = document.getElementById('dropdown-section')
    if (dropdownSection) {
      const dropdownHeight = dropdownSection.offsetHeight + this.header.height + divider
      if (dropdownHeight > maxHeight) {
        maxHeight = dropdownHeight
      }
    }

    return maxHeight
  }

  async ngOnInit () {
    await this.sync()
    await this.fixUIMode()
    this.startDimensionsSync()
    await this.setupPrivacy()
  }

  async setupPrivacy () {
    const [ uiSettings ] = await Promise.all([
      this.ui.getSettings()
    ])

    if (typeof uiSettings.privacyFormSeen !== 'boolean') {
      let doCollectTelemetry = uiSettings.doCollectTelemetry ?? false
      let doCollectCrashReports = await this.settings.getDoCollectCrashReports()
      let saving = false

      const doCollectTelemetryOption: Option = {
        type: 'checkbox',
        label: 'Send Anonymous Analytics data',
        tooltip: `
eqMac would collect anonymous Telemetry analytics data like:

• macOS Version
• App and UI Version
• Country (IP Addresses are anonymized)

This helps us understand distribution of our users.
`,
        tooltipAsComponent: true,
        value: doCollectTelemetry,
        isEnabled: () => !saving,
        toggled: doCollect => {
          doCollectTelemetry = doCollect
        }
      }

      const doCollectCrashReportsOption: Option = {
        type: 'checkbox',
        label: 'Send Anonymous Crash reports',
        tooltip: `
eqMac would send anonymized crash reports
back to the developer in case eqMac crashes.
This helps us understand improve eqMac 
and make it a more stable product.
`,
        tooltipAsComponent: true,
        value: doCollectCrashReports,
        isEnabled: () => !saving,
        toggled: doCollect => {
          doCollectCrashReports = doCollect
        }
      }
      const privacyDialog: MatDialogRef<OptionsDialogComponent> = this.dialog.open(OptionsDialogComponent, {
        hasBackdrop: true,
        disableClose: true,
        data: {
          options: [
            [ { type: 'label', label: 'Privacy' } ],
            [ {
              type: 'label', label: `eqMac respects its user's privacy 
and is giving you a choice what data you wish to share with the developer.
This data would help us improve and grow the product.`
            } ],
            [ doCollectTelemetryOption ],
            [ doCollectCrashReportsOption ],
            [
              {
                type: 'button',
                label: 'Save',
                isEnabled: () => !saving,
                action: () => privacyDialog.close()
              },
              {
                type: 'button',
                label: 'Accept all',
                isEnabled: () => !saving,
                action: async () => {
                  doCollectCrashReports = true
                  doCollectTelemetry = true
                  doCollectCrashReportsOption.value = true
                  doCollectTelemetryOption.value = true
                  saving = true
                  await this.utils.delay(200)
                  privacyDialog.close()
                }
              }
            ]
          ] as Options
        }
      })

      await privacyDialog.afterClosed().toPromise()

      await Promise.all([
        this.ui.setSettings({
          privacyFormSeen: true,
          doCollectTelemetry
        }),
        this.settings.setDoCollectCrashReports({
          doCollectCrashReports
        })
      ])
    }

    if (uiSettings.doCollectTelemetry) {
      await this.analytics.init()
    }
  }

  async ngAfterContentInit () {
    await this.utils.delay(this.animationDuration)
    this.loaded = true
    await this.utils.delay(1000)
    this.ui.loaded()
  }

  async sync () {
    await Promise.all([
      this.getTransitionSettings()
    ])
  }

  async startDimensionsSync () {
    this.handleWindowResize()
    setInterval(() => {
      this.syncMinHeight()
      this.syncMaxHeight()
    }, 1000)
  }

  private previousMinHeight: number
  async syncMinHeight () {
    if (!this.previousMinHeight) {
      this.previousMinHeight = this.minHeight
      await this.ui.setMinHeight({ minHeight: this.minHeight })
      return
    }

    const diff = this.minHeight - this.previousMinHeight
    this.previousMinHeight = this.minHeight
    if (diff !== 0) {
      this.ui.onMinHeightChanged.emit()
      await this.ui.setMinHeight({ minHeight: this.minHeight })
    }

    if (diff < 0) {
      this.ui.changeHeight({ diff })
    }
  }

  private previousMaxHeight: number
  async syncMaxHeight () {
    if (!this.previousMaxHeight) {
      this.previousMaxHeight = this.maxHeight
      await this.ui.setMaxHeight({ maxHeight: this.maxHeight })
      return
    }

    const diff = this.maxHeight - this.previousMaxHeight
    this.previousMaxHeight = this.maxHeight
    await this.ui.setMaxHeight({ maxHeight: this.maxHeight })
    if (diff > 0) {
      // this.ui.changeHeight({ diff })
    }
  }

  private windowResizeHandlerTimer: number
  @HostListener('window:resize')
  handleWindowResize () {
    if (this.windowResizeHandlerTimer) {
      clearTimeout(this.windowResizeHandlerTimer)
    }

    this.windowResizeHandlerTimer = setTimeout(async () => {
      const [ height, width ] = await Promise.all([
        this.ui.getHeight(),
        this.ui.getWidth()
      ])

      this.containerHeight = height
      this.containerWidth = width

      setTimeout(() => {
        this.ui.dimensionsChanged.emit()
      }, 100)
    }, 100) as any
  }

  async getTransitionSettings () {
    const settings = await this.transitions.getSettings()
    this.animationDuration = settings.duration
    this.animationFps = settings.fps
  }

  toggleDropdownSection (section: string) {
    for (const key in this.showDropdownSections) {
      this.showDropdownSections[key] = key === section ? !this.showDropdownSections[key] : false
    }
  }

  openDropdownSection (section: string) {
    for (const key in this.showDropdownSections) {
      this.showDropdownSections[key] = key === section
    }
  }

  async fixUIMode () {
    const [ mode, iconMode ] = await Promise.all([
      this.ui.getMode(),
      this.settings.getIconMode()
    ])

    if (mode === 'popover' && iconMode === IconMode.dock) {
      await this.ui.setMode('window')
    }
  }

  closeDropdownSection (section: string, event?: MouseEvent) {
    // if (event && event.target && ['backdrop', 'mat-dialog'].some(e => event.target.className.includes(e))) return
    if (this.dialog.openDialogs.length > 0) return
    if (section in this.showDropdownSections) {
      this.showDropdownSections[section] = false
    }
  }
}
