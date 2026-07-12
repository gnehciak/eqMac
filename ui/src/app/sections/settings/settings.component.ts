import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { CheckboxOption, ButtonOption, Options, SelectOption, DividerOption, FlatSliderOption, LabelOption, ValueScreenOption } from 'src/app/components/options/options.component'
import { SettingsService, IconMode } from './settings.service'
import { ApplicationService } from '../../services/app.service'
import { MatDialog } from '@angular/material/dialog'
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component'
import { StatusItemIconType, UIService } from '../../services/ui.service'
import { AnalyticsService } from '../../services/analytics.service'
import { SemanticVersion } from '../../services/semantic-version.service'
import { OptionsDialogComponent } from '../../components/options-dialog/options-dialog.component'
import { KnobControlStyle } from '../../../../../modules/components/src'
import { TranslateService } from '../../services/translate.service'
import { ToastService } from '../../services/toast.service'
import { ThemePickerDialogComponent } from './themes/theme-picker-dialog.component'
import { ArrangementDialogComponent } from './themes/arrangement-dialog.component'
import { SuperPresetsDialogComponent } from './super-presets/super-presets-dialog.component'
import { HotkeysDialogComponent } from './hotkeys/hotkeys-dialog.component'
import { MIDIDialogComponent } from './midi/midi-dialog.component'
import { HearingTestDialogComponent } from './hearing-test/hearing-test-dialog.component'

@Component({
  selector: 'eqm-settings',
  templateUrl: './settings.component.html',
  styleUrls: [ './settings.component.scss' ]
})
export class SettingsComponent implements OnInit, OnDestroy {
  launchOnStartupOption: CheckboxOption = {
    type: 'checkbox',
    label: 'Launch on login',
    value: false,
    toggled: launchOnStartup => this.settingsService.setLaunchOnStartup(launchOnStartup)
  }

  replaceKnobsWithSlidersOption: CheckboxOption = {
    type: 'checkbox',
    label: 'Knobs → Sliders',
    value: false,
    toggled: replaceKnobsWithSliders => {
      this.ui.setSettings({ replaceKnobsWithSliders })
      this.app.ref.closeDropdownSection('settings')
    }
  }

  knobControlStyleOption: SelectOption<KnobControlStyle> = {
    type: 'select',
    label: 'Knob Control',
    options: [ {
      id: 'directional',
      icon: 'move'
    }, {
      id: 'rotational',
      icon: 'refresh'
    } ],
    selectedId: 'directional',
    selected: knobControlStyle => {
      this.ui.setSettings({ knobControlStyle })
    }
  }

  alwaysOnTopOption: CheckboxOption = {
    type: 'checkbox',
    label: 'Always on top',
    value: false,
    toggled: alwaysOnTop => {
      this.ui.setAlwaysOnTop({ alwaysOnTop })
    }
  }

  doCollectTelemetryOption: CheckboxOption = {
    type: 'checkbox',
    label: 'Send Analytics telemetry',
    tooltip: `
eqMac would collect anonymous Telemetry analytics data like:

• macOS Version
• App and UI Version
• Country (IP Addresses are anonymized)

This helps us understand distribution of our users.
`,
    value: false,
    toggled: doCollectTelemetry => {
      this.ui.setSettings({ doCollectTelemetry })
      if (doCollectTelemetry) {
        this.analytics.init()
      } else {
        this.analytics.deinit()
      }
    }
  }

  doCollectCrashReportsOption: CheckboxOption = {
    type: 'checkbox',
    label: 'Send Crash reports',
    tooltip: `
eqMac would send anonymized crash reports
back to the developer in case eqMac crashes.
This helps us understand improve eqMac 
and make it a more stable product.
`,
    value: false,
    toggled: doCollectCrashReports => {
      this.settingsService.setDoCollectCrashReports({
        doCollectCrashReports
      })
    }
  }

  iconModeOption: SelectOption = {
    type: 'select',
    label: 'Show Icon',
    options: [ {
      id: IconMode.dock,
      label: 'Dock'
    }, {
      id: IconMode.both,
      label: 'Both'
    }, {
      id: IconMode.statusBar,
      label: 'Status Bar'
    }, {
      id: IconMode.neither,
      label: 'Neither'
    } ],
    selectedId: IconMode.both,
    selected: async iconMode => {
      const uiMode = await this.ui.getMode()
      if (iconMode === IconMode.dock && uiMode === 'popover') {
        await this.ui.setMode('window')
      }
      await this.settingsService.setIconMode(iconMode as IconMode)
    }
  }

  uninstallOption: ButtonOption = {
    type: 'button',
    label: 'Uninstall eqMac',
    hoverable: false,
    action: this.uninstall.bind(this)
  }

  updateOption: ButtonOption = {
    type: 'button',
    label: 'Check for Updates',
    action: this.update.bind(this)
  }

  autoCheckUpdatesOption: CheckboxOption = {
    type: 'checkbox',
    value: false,
    label: 'Auto Check',
    toggled: doAutoCheckUpdates => {
      this.settingsService.setDoAutoCheckUpdates({
        doAutoCheckUpdates
      })
    }
  }

  otaUpdatesOption: CheckboxOption = {
    type: 'checkbox',
    value: false,
    label: 'OTA Updates',
    tooltip: `
Because eqMac's User Interface is built with Web Technologies 
the developer can periodically push Over the Air (OTA) updates,
make minor bug fixes and UI improvements,
all without needing the user to do a full app update.
`,
    tooltipAsComponent: false,
    toggled: doOTAUpdates => {
      this.settingsService.setDoOTAUpdates({
        doOTAUpdates
      })
    }
  }

  betaUpdatesOption: CheckboxOption = {
    type: 'checkbox',
    value: false,
    label: 'Beta Program',
    tooltip: `
Get and test the most latest changes to eqMac.
Help the developer identify and fix uncaught issues, 
before they go out to all users.
`,
    toggled: doBetaUpdates => {
      this.settingsService.setDoBetaUpdates({
        doBetaUpdates
      })
    }
  }

  statusItemIconTypeOption: SelectOption = {
    type: 'select',
    label: 'Status Icon Type',
    isEnabled: () => ([ IconMode.both, IconMode.statusBar ] as IconMode[]).includes(this.iconModeOption.selectedId as any),
    options: [ {
      id: StatusItemIconType.classic,
      label: 'Classic'
    }, {
      id: StatusItemIconType.colored,
      label: 'Colored'
    }, {
      id: StatusItemIconType.macOS,
      label: 'macOS'
    } ],
    selectedId: StatusItemIconType.classic,
    selected: async (statusItemIconType: StatusItemIconType) => {
      await this.ui.setStatusItemIconType(statusItemIconType)
    }
  }

  uiScaleLabel: LabelOption = {
    type: 'label',
    label: 'UI Scale'
  }

  setUIScaleScreenValue () {
    this.uiScaleScreen.value = `${Math.round(this.uiScaleSlider.value * 100)}%`
  }

  uiScaleSliderDebounceTimer: number
  uiScaleSlider: FlatSliderOption = {
    type: 'flat-slider',
    value: 1,
    min: 0.5,
    max: 2,
    orientation: 'horizontal',
    doubleClickToAnimateToMiddle: false,
    middle: 1,
    stickToMiddle: true,
    showMiddleNotch: true,
    scrollEnabled: false,
    userChangedValue: event => {
      this.setUIScaleScreenValue()
      this.changeRef.detectChanges()
      if (this.uiScaleSliderDebounceTimer) {
        clearTimeout(this.uiScaleSliderDebounceTimer)
      }
      this.uiScaleSliderDebounceTimer = setTimeout(() => {
        this.ui.setScale(event.value)
      }, 1000) as any
    },
    style: {
      width: '700px'
    }
  }

  uiScaleScreen: ValueScreenOption = {
    type: 'value-screen',
    value: '100%'
  }

  hideShowFeaturesOption: ButtonOption = {
    type: 'button',
    label: 'Show/Hide Features',
    action: async () => {
      const uiSettings = await this.ui.getSettings()
      const volume: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('settings.volume'),
        value: uiSettings.volumeFeatureEnabled ?? true,
        toggled: volumeFeatureEnabled => {
          this.ui.setSettings({ volumeFeatureEnabled })
        }
      }

      const balance: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('settings.balance'),
        value: uiSettings.balanceFeatureEnabled ?? true,
        toggled: balanceFeatureEnabled => {
          this.ui.setSettings({ balanceFeatureEnabled })
        }
      }

      const appMixer: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('sections.appMixer'),
        value: uiSettings.appMixerFeatureEnabled ?? true,
        toggled: appMixerFeatureEnabled => {
          this.ui.setSettings({ appMixerFeatureEnabled })
        }
      }

      const equalizers: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('settings.equalizers'),
        value: uiSettings.equalizersFeatureEnabled ?? true,
        toggled: equalizersFeatureEnabled => {
          this.ui.setSettings({ equalizersFeatureEnabled })
        }
      }

      const effects: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('sections.effects'),
        value: uiSettings.effectsFeatureEnabled ?? true,
        toggled: effectsFeatureEnabled => {
          this.ui.setSettings({ effectsFeatureEnabled })
        }
      }

      const spatial: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('sections.spatial'),
        value: uiSettings.spatialFeatureEnabled ?? true,
        toggled: spatialFeatureEnabled => {
          this.ui.setSettings({ spatialFeatureEnabled })
        }
      }

      const audioUnits: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('sections.audioUnits'),
        value: uiSettings.audioUnitsFeatureEnabled ?? true,
        toggled: audioUnitsFeatureEnabled => {
          this.ui.setSettings({ audioUnitsFeatureEnabled })
        }
      }

      const recorder: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('sections.recorder'),
        value: uiSettings.recorderFeatureEnabled ?? true,
        toggled: recorderFeatureEnabled => {
          this.ui.setSettings({ recorderFeatureEnabled })
        }
      }

      const output: CheckboxOption = {
        type: 'checkbox',
        label: this.translate.instant('settings.output'),
        value: uiSettings.outputFeatureEnabled ?? true,
        toggled: outputFeatureEnabled => {
          this.ui.setSettings({ outputFeatureEnabled })
        }
      }
      const options: Options = [
        [ volume, balance ],
        [ this.divider ],
        [ appMixer ],
        [ this.divider ],
        [ equalizers ],
        [ this.divider ],
        [ effects, spatial ],
        [ this.divider ],
        [ audioUnits, recorder ],
        [ this.divider ],
        [ output ]
      ]

      await this.dialog.open(OptionsDialogComponent, {
        hasBackdrop: true,
        disableClose: false,
        data: {
          options
        }
      })
    }
  }

  languageOption: SelectOption = {
    type: 'select',
    label: 'Language',
    options: [],  // built from translate.availableLocales in applyTranslations()
    selectedId: 'en',
    selected: locale => {
      this.translate.setLocale(locale)
    }
  }

  themeOption: ButtonOption = {
    type: 'button',
    label: 'Theme',
    action: () => {
      this.dialog.open(ThemePickerDialogComponent, {
        hasBackdrop: true,
        disableClose: false
      })
    }
  }

  arrangeFeaturesOption: ButtonOption = {
    type: 'button',
    label: 'Arrange Features',
    action: () => {
      this.dialog.open(ArrangementDialogComponent, {
        hasBackdrop: true,
        disableClose: false
      })
    }
  }

  superPresetsOption: ButtonOption = {
    type: 'button',
    label: 'Super Presets',
    action: async () => {
      await this.dialog.open(SuperPresetsDialogComponent, {
        hasBackdrop: true,
        disableClose: false,
        width: '420px'
      }).afterClosed().toPromise()
    }
  }

  hotkeysOption: ButtonOption = {
    type: 'button',
    label: 'Global Hotkeys',
    action: async () => {
      await this.dialog.open(HotkeysDialogComponent, {
        hasBackdrop: true,
        disableClose: false
      }).afterClosed().toPromise()
    }
  }

  midiOption: ButtonOption = {
    type: 'button',
    label: 'MIDI Controls',
    action: async () => {
      await this.dialog.open(MIDIDialogComponent, {
        hasBackdrop: true,
        disableClose: false
      }).afterClosed().toPromise()
    }
  }

  hearingTestOption: ButtonOption = {
    type: 'button',
    label: 'Hearing Test',
    action: async () => {
      await this.dialog.open(HearingTestDialogComponent, {
        hasBackdrop: true,
        disableClose: false
      }).afterClosed().toPromise()
    }
  }

  backupLabel: LabelOption = {
    type: 'label',
    label: 'Backup'
  }

  saveBackupOption: ButtonOption = {
    type: 'button',
    label: 'Save Backup',
    tooltip: 'Saves all eqMac settings and presets into a single .eqmacbackup file',
    action: async () => {
      try {
        const message = await this.app.request({ method: 'GET', endpoint: '/backup/export' })
        this.toast.show({ type: 'success', message })
      } catch {
        // DataService.request already toasts the native error (e.g. Cancelled)
      }
    }
  }

  restoreBackupOption: ButtonOption = {
    type: 'button',
    label: 'Restore Backup',
    tooltip: 'Restores settings and presets from a .eqmacbackup file. eqMac will ask to restart',
    action: async () => {
      try {
        const message = await this.app.request({ method: 'GET', endpoint: '/backup/import' })
        this.toast.show({ type: 'success', message })
      } catch {
        // DataService.request already toasts the native error (e.g. Cancelled)
      }
    }
  }

  updatesLabel: LabelOption = { type: 'label', label: 'Updates' }
  privacyLabel: LabelOption = { type: 'label', label: 'Privacy' }

  private readonly divider: DividerOption = { type: 'divider', orientation: 'horizontal' }
  settings: Options = [
    [ this.uiScaleLabel, this.uiScaleSlider, this.uiScaleScreen ],
    [ this.iconModeOption ],
    [ this.statusItemIconTypeOption ],
    [
      this.launchOnStartupOption,
      this.alwaysOnTopOption
    ],
    [
      this.replaceKnobsWithSlidersOption,
      this.knobControlStyleOption
    ],
    [ this.languageOption ],
    [
      this.themeOption,
      this.arrangeFeaturesOption
    ],
    [ this.hideShowFeaturesOption ],
    [
      this.superPresetsOption,
      this.hotkeysOption
    ],
    [
      this.midiOption,
      this.hearingTestOption
    ],

    [ this.divider ],

    [ this.updatesLabel ],
    [
      this.betaUpdatesOption,
      this.autoCheckUpdatesOption,
      this.otaUpdatesOption
    ],
    [
      this.updateOption
    ],

    [ this.divider ],

    // Privacy
    [ this.privacyLabel ],
    [
      this.doCollectTelemetryOption,
      this.doCollectCrashReportsOption
    ],

    [ this.divider ],

    // Backup
    [ this.backupLabel ],
    [
      this.saveBackupOption,
      this.restoreBackupOption
    ],

    [ this.divider ],
    // Misc
    [ this.uninstallOption ]
  ]

  constructor (
    public settingsService: SettingsService,
    public app: ApplicationService,
    public dialog: MatDialog,
    public ui: UIService,
    public analytics: AnalyticsService,
    private readonly changeRef: ChangeDetectorRef,
    private readonly translate: TranslateService,
    private readonly toast: ToastService
  ) {
    this.applyTranslations()
  }

  // Options arrays carry TS-built labels — retranslate them in place when
  // the user switches language (object identity preserved so rows stay valid)
  private applyTranslations () {
    const t = (key: string) => this.translate.instant(key)

    this.launchOnStartupOption.label = t('settings.launchOnLogin')
    this.replaceKnobsWithSlidersOption.label = t('settings.knobsToSliders')
    this.knobControlStyleOption.label = t('settings.knobControl')
    this.alwaysOnTopOption.label = t('settings.alwaysOnTop')
    this.doCollectTelemetryOption.label = t('settings.sendTelemetry')
    this.doCollectTelemetryOption.tooltip = t('settings.telemetryTooltip')
    this.doCollectCrashReportsOption.label = t('settings.sendCrashReports')
    this.doCollectCrashReportsOption.tooltip = t('settings.crashReportsTooltip')
    this.iconModeOption.label = t('settings.showIcon')
    this.iconModeOption.options[0].label = t('settings.dock')
    this.iconModeOption.options[1].label = t('settings.both')
    this.iconModeOption.options[2].label = t('settings.statusBar')
    this.iconModeOption.options[3].label = t('settings.neither')
    this.uninstallOption.label = t('settings.uninstall')
    this.updateOption.label = t('settings.checkForUpdates')
    this.autoCheckUpdatesOption.label = t('settings.autoCheck')
    this.otaUpdatesOption.label = t('settings.otaUpdates')
    this.otaUpdatesOption.tooltip = t('settings.otaUpdatesTooltip')
    this.betaUpdatesOption.label = t('settings.betaProgram')
    this.betaUpdatesOption.tooltip = t('settings.betaProgramTooltip')
    this.statusItemIconTypeOption.label = t('settings.statusIconType')
    this.statusItemIconTypeOption.options[0].label = t('settings.classic')
    this.statusItemIconTypeOption.options[1].label = t('settings.colored')
    this.statusItemIconTypeOption.options[2].label = t('settings.macOS')
    this.uiScaleLabel.label = t('settings.uiScale')
    this.hideShowFeaturesOption.label = t('settings.showHideFeatures')
    this.updatesLabel.label = t('settings.updates')
    this.privacyLabel.label = t('settings.privacy')

    this.languageOption.label = t('settings.language')
    // Locale names are rendered in their own language — intentionally untranslated
    this.languageOption.options = this.translate.availableLocales
      .map(locale => ({ id: locale.id, label: locale.name }))
    this.languageOption.selectedId = this.translate.locale
    this.themeOption.label = t('settings.theme')
    this.arrangeFeaturesOption.label = t('settings.arrangeFeatures')
    this.superPresetsOption.label = t('superPresets.title')
    this.hotkeysOption.label = t('hotkeys.title')
    this.midiOption.label = t('midi.title')
    this.hearingTestOption.label = t('hearingTest.title')
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
  }

  async sync () {
    await Promise.all([
      this.syncSettings()
    ])
  }

  async syncSettings () {
    const [
      launchOnStartup,
      iconMode,
      UISettings,
      doCollectCrashReports,
      doAutoCheckUpdates,
      doOTAUpdates,
      alwaytOnTop,
      statusItemIconType,
      doBetaUpdates,
      uiScale
    ] = await Promise.all([
      this.settingsService.getLaunchOnStartup(),
      this.settingsService.getIconMode(),
      this.ui.getSettings(),
      this.settingsService.getDoCollectCrashReports(),
      this.settingsService.getDoAutoCheckUpdates(),
      this.settingsService.getDoOTAUpdates(),
      this.ui.getAlwaysOnTop(),
      this.ui.getStatusItemIconType(),
      this.settingsService.getDoBetaUpdates(),
      this.ui.getScale()
    ])
    this.iconModeOption.selectedId = iconMode
    this.launchOnStartupOption.value = launchOnStartup
    this.replaceKnobsWithSlidersOption.value = UISettings.replaceKnobsWithSliders
    this.knobControlStyleOption.selectedId = UISettings.knobControlStyle
    this.doCollectTelemetryOption.value = UISettings.doCollectTelemetry
    this.doCollectCrashReportsOption.value = doCollectCrashReports
    this.autoCheckUpdatesOption.value = doAutoCheckUpdates
    this.otaUpdatesOption.value = doOTAUpdates
    this.alwaysOnTopOption.value = alwaytOnTop
    this.statusItemIconTypeOption.selectedId = statusItemIconType
    this.betaUpdatesOption.value = doBetaUpdates
    this.uiScaleSlider.value = uiScale
    this.languageOption.selectedId = this.translate.locale
    this.setUIScaleScreenValue()
  }

  async update () {
    this.app.update()
  }

  async uninstall () {
    this.app.uninstall()
  }
}
