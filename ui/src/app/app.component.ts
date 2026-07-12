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
import { SuperPresetBarComponent } from './sections/super-preset-bar/super-preset-bar.component'
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
  @ViewChild('superPresetBar', { static: false }) superPresetBar: SuperPresetBarComponent

  // Main-section rendering order (Arrangement dialog persists
  // UISettings.sectionOrder; normalizeSectionOrder always returns all
  // known section ids, appending missing ones in default order)
  get sectionOrder (): string[] {
    return normalizeSectionOrder(this.ui.settings.sectionOrder)
  }

  // Pro-look two-column layout: everything except the Equalizers lives in
  // the fixed-width left rail (in the user's arranged order); the
  // Equalizers section fills the flexible right column.
  get leftSectionOrder (): string[] {
    return this.sectionOrder.filter(sectionId => sectionId !== 'equalizers')
  }

  isLastLeftSection (sectionId: string): boolean {
    const order = this.leftSectionOrder
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

  // Sums the heights of the enabled + rendered LEFT rail sections, in
  // rendered order. Every rendered element except the last one is
  // followed by an eqm-divider (the Super Preset bar renders right after
  // the App Mixer, matching the template). ViewChild refs are
  // null-guarded: right after a visibility toggle a ref can be undefined
  // for one CD cycle and the 1s dimensions poll must not throw.
  private leftColumnHeight (): number {
    const divider = 3

    const {
      volumeFeatureEnabled, balanceFeatureEnabled,
      appMixerFeatureEnabled,
      effectsFeatureEnabled,
      spatialFeatureEnabled,
      audioUnitsFeatureEnabled,
      recorderFeatureEnabled,
      outputFeatureEnabled,
      superPresetsBarFeatureEnabled
    } = this.ui.settings

    const heights: number[] = []
    for (const sectionId of this.leftSectionOrder) {
      switch (sectionId) {
        case 'volume':
          if ((volumeFeatureEnabled || balanceFeatureEnabled) && this.volumeBoosterBalance) {
            heights.push(this.volumeBoosterBalance.height)
          }
          break
        case 'app-mixer':
          if (appMixerFeatureEnabled && this.appMixer) {
            heights.push(this.appMixer.height)
          }
          if (superPresetsBarFeatureEnabled && this.superPresetBar) {
            heights.push(this.superPresetBar.height)
          }
          break
        case 'effects':
          if (effectsFeatureEnabled && this.audioEffects) {
            heights.push(this.audioEffects.height)
          }
          break
        case 'spatial':
          if (spatialFeatureEnabled && this.spatial) {
            heights.push(this.spatial.height)
          }
          break
        case 'audio-units':
          if (audioUnitsFeatureEnabled && this.audioUnits) {
            heights.push(this.audioUnits.height)
          }
          break
        case 'recorder':
          if (recorderFeatureEnabled && this.recorder) {
            heights.push(this.recorder.height)
          }
          break
        case 'outputs':
          if (outputFeatureEnabled && this.outputs) {
            heights.push(this.outputs.height)
          }
          break
      }
    }

    return heights.reduce((sum, height) => sum + height, 0) +
      Math.max(heights.length - 1, 0) * divider
  }

  private rightColumnHeight ({ useEqualizersMaxHeight }: { useEqualizersMaxHeight: boolean }): number {
    if (!this.ui.settings.equalizersFeatureEnabled || !this.equalizers) return 0
    return useEqualizersMaxHeight ? this.equalizers.maxHeight : this.equalizers.height
  }

  // Two-column window height: header chrome + the taller of the two columns
  private columnsHeight ({ useEqualizersMaxHeight }: { useEqualizersMaxHeight: boolean }): number {
    return Math.max(
      this.leftColumnHeight(),
      this.rightColumnHeight({ useEqualizersMaxHeight })
    )
  }

  get minHeight () {
    const divider = 3

    let minHeight = this.header.height + divider +
      this.columnsHeight({ useEqualizersMaxHeight: false })

    const dropdownSection = document.getElementById('dropdown-section')
    if (dropdownSection) {
      const dropdownHeight = dropdownSection.offsetHeight + this.header.height + divider
      if (dropdownHeight > minHeight) {
        minHeight = dropdownHeight
      }
    }

    return minHeight
  }

  // Keep in sync with app.component.scss (.left-column / .right-column
  // widths + the 3px vertical eqm-divider between the columns)
  private readonly leftColumnWidth = 420
  private readonly columnDividerWidth = 3
  private readonly rightColumnMinWidth = 620

  get minWidth () {
    // Right EQ column only renders when the Equalizers feature is on;
    // without it the window collapses back to the single left rail.
    if (!this.ui.settings.equalizersFeatureEnabled) {
      return this.leftColumnWidth
    }
    // 420 + 3 + 620 = 1043 -> pad the EQ column up to the ~1080 Pro default
    return Math.max(
      this.leftColumnWidth + this.columnDividerWidth + this.rightColumnMinWidth,
      1080
    )
  }

  get maxHeight () {
    const divider = 3

    let maxHeight = this.header.height + divider +
      this.columnsHeight({ useEqualizersMaxHeight: true })

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
      this.syncMinWidth()
    }, 1000)
  }

  // The two-column Pro layout needs a wider window than the old
  // single-column flow (native persisted 400px). Push the new minWidth to
  // the native side and grow the window if it is currently narrower.
  private previousMinWidth: number
  private syncingMinWidth = false
  async syncMinWidth () {
    if (this.syncingMinWidth) return
    const minWidth = this.minWidth
    if (this.previousMinWidth === minWidth) return
    this.syncingMinWidth = true
    try {
      this.previousMinWidth = minWidth
      await this.ui.setMinWidth({ minWidth })
      const width = await this.ui.getWidth()
      if (width < minWidth) {
        await this.ui.setWidth(minWidth)
      }
    } finally {
      this.syncingMinWidth = false
    }
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
