import {
  BrowserModule
} from '@angular/platform-browser'
import {
  NgModule
} from '@angular/core'

import {
  AppComponent
} from './app.component'

import {
  FlexLayoutModule
} from '@angular/flex-layout'

import {
  ComponentsModule,
  EqGraphComponent,
  SpectrumComponent,
  VirtualDropdownComponent,
  FaderComponent
} from '@eqmac/components'

import { PipesModule } from './modules/pipes/pipes.module'

import {
  CommonModule
} from '@angular/common'

import {
  HeaderComponent
} from './sections/header/header.component'
import {
  SourceComponent
} from './sections/source/source.component'
import {
  BoosterComponent
} from './sections/volume/booster-balance/booster/booster.component'
import {
  BalanceComponent
} from './sections/volume/booster-balance/balance/balance.component'
import {
  EqualizersComponent
} from './sections/effects/equalizers/equalizers.component'
import {
  RecorderComponent
} from './sections/recorder/recorder.component'
import {
  OutputsComponent
} from './sections/outputs/outputs.component'

import {
  InputComponent
} from './sections/source/input/input.component'
import {
  FileComponent
} from './sections/source/file/file.component'
import {
  SystemComponent
} from './sections/source/system/system.component'
import {
  BasicEqualizerComponent
} from './sections/effects/equalizers/basic-equalizer/basic-equalizer.component'
import {
  AdvancedEqualizerComponent
} from './sections/effects/equalizers/advanced-equalizer/advanced-equalizer.component'
import {
  VolumeBoosterBalanceComponent
} from './sections/volume/booster-balance/volume-booster-balance.component'

import { BrowserAnimationsModule } from '@angular/platform-browser/animations'
import { SettingsComponent } from './sections/settings/settings.component'
import { OptionsComponent } from './components/options/options.component'
import { HelpComponent } from './sections/help/help.component'
import { MatDialogConfig, MatDialogModule, MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog'
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component'
import { EqualizerPresetsComponent } from './sections/effects/equalizers/presets/equalizer-presets.component'
import { PromptDialogComponent } from './components/prompt-dialog/prompt-dialog.component'
import { OptionsDialogComponent } from './components/options-dialog/options-dialog.component'
import { MatSnackBarModule } from '@angular/material/snack-bar'
import { UIService } from './services/ui.service'
import { TranslatePipe } from './pipes/translate.pipe'
import { ExpertEqualizerComponent } from './sections/effects/equalizers/expert-equalizer/expert-equalizer.component'
import { BandInspectorComponent } from './sections/effects/equalizers/expert-equalizer/band-inspector.component'
import { BandStripComponent } from './sections/effects/equalizers/expert-equalizer/band-strip.component'
import { AutoEQBrowserComponent } from './sections/effects/equalizers/expert-equalizer/autoeq/autoeq-browser.component'
import { Graphic31EqualizerComponent } from './sections/effects/equalizers/graphic31-equalizer/graphic31-equalizer.component'
import { AppMixerComponent } from './sections/app-mixer/app-mixer.component'
import { AppRowComponent } from './sections/app-mixer/app-row/app-row.component'
import { AudioEffectsComponent } from './sections/effects/audio-effects/audio-effects.component'
import { SpatialComponent } from './sections/effects/spatial/spatial.component'
import { AudioUnitsComponent } from './sections/effects/audio-units/audio-units.component'
import { SuperPresetsDialogComponent } from './sections/settings/super-presets/super-presets-dialog.component'
import { HotkeysDialogComponent } from './sections/settings/hotkeys/hotkeys-dialog.component'
import { MIDIDialogComponent } from './sections/settings/midi/midi-dialog.component'
import { ThemePickerDialogComponent } from './sections/settings/themes/theme-picker-dialog.component'
import { ArrangementDialogComponent } from './sections/settings/themes/arrangement-dialog.component'
import { HearingTestDialogComponent } from './sections/settings/hearing-test/hearing-test-dialog.component'
import { SuperPresetBarComponent } from './sections/super-preset-bar/super-preset-bar.component'
import { SignalChainComponent } from './sections/signal-chain/signal-chain.component'

@NgModule({
  imports: [
    CommonModule,
    BrowserAnimationsModule,
    FlexLayoutModule,
    PipesModule,
    ComponentsModule,
    MatDialogModule,
    MatSnackBarModule,
    BrowserModule
  ],
  entryComponents: [
    ConfirmDialogComponent,
    PromptDialogComponent,
    OptionsDialogComponent,
    SuperPresetsDialogComponent,
    HotkeysDialogComponent,
    MIDIDialogComponent,
    ThemePickerDialogComponent,
    ArrangementDialogComponent,
    AutoEQBrowserComponent,
    HearingTestDialogComponent
  ],
  declarations: [
    AppComponent,
    HeaderComponent,
    SourceComponent,
    BoosterComponent,
    BalanceComponent,
    EqualizersComponent,
    RecorderComponent,
    OutputsComponent,
    InputComponent,
    FileComponent,
    SystemComponent,
    BasicEqualizerComponent,
    AdvancedEqualizerComponent,
    VolumeBoosterBalanceComponent,
    SettingsComponent,
    OptionsComponent,
    HelpComponent,
    ConfirmDialogComponent,
    EqualizerPresetsComponent,
    PromptDialogComponent,
    OptionsDialogComponent,
    TranslatePipe,
    // New library widgets (exported from @eqmac/components but not yet
    // declared by ComponentsModule — declared here so AppModule templates
    // can use them; move into ComponentsModule if it ever declares them)
    EqGraphComponent,
    SpectrumComponent,
    VirtualDropdownComponent,
    // eqm-fader ships in @eqmac/components' barrel but ComponentsModule does
    // not declare it, so AppModule owns the declaration (single-module rule).
    FaderComponent,
    // Wave 2/3 sections and dialogs
    ExpertEqualizerComponent,
    BandInspectorComponent,
    BandStripComponent,
    AutoEQBrowserComponent,
    Graphic31EqualizerComponent,
    AppMixerComponent,
    AppRowComponent,
    SuperPresetBarComponent,
    AudioEffectsComponent,
    SpatialComponent,
    AudioUnitsComponent,
    SignalChainComponent,
    SuperPresetsDialogComponent,
    HotkeysDialogComponent,
    MIDIDialogComponent,
    ThemePickerDialogComponent,
    ArrangementDialogComponent,
    HearingTestDialogComponent
  ],
  providers: [
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: {
        ...new MatDialogConfig(),
        hasBackdrop: true,
        disableClose: false
      } as MatDialogConfig
    }
  ],
  bootstrap: [ AppComponent ]
})
export class AppModule {}
