import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { PromptDialogComponent } from 'src/app/components/prompt-dialog/prompt-dialog.component'
import { ConfirmDialogComponent } from 'src/app/components/confirm-dialog/confirm-dialog.component'
import { TranslateService } from 'src/app/services/translate.service'
import { IconName } from '@eqmac/components'

export interface EqualizerPreset {
  id?: string
  name: string
  isDefault?: boolean
}

export interface AdditionalPresetOption {
  tooltip: string
  icon: IconName
  iconSize?: number
  action: () => void | Promise<void>
}

@Component({
  selector: 'eqm-equalizer-presets',
  templateUrl: './equalizer-presets.component.html',
  styleUrls: [ './equalizer-presets.component.scss' ]
})
export class EqualizerPresetsComponent implements OnInit {
  @Input() presets: EqualizerPreset[]
  @Input() enabled = true
  @Input() selectedPreset: EqualizerPreset
  @Output() presetSelected = new EventEmitter<EqualizerPreset>()
  @Output() presetSaved = new EventEmitter<string>()
  @Output() presetDeleted = new EventEmitter()
  @Input() additionalLeftOption?: AdditionalPresetOption
  @Input() additionalRightOption?: AdditionalPresetOption

  constructor (
    public dialog: MatDialog,
    private readonly translate: TranslateService
  ) { }

  ngOnInit () {
  }

  async savePreset (presetName?: string) {
    presetName = await this.dialog.open(PromptDialogComponent, {
      hasBackdrop: true,
      disableClose: true,
      data: {
        confirmText: this.translate.instant('presets.save'),
        cancelText: this.translate.instant('presets.cancel'),
        text: this.translate.instant('presets.enterName'),
        placeholder: this.translate.instant('presets.newPresetName'),
        prompt: presetName
      }
    }).afterClosed().toPromise()

    if (presetName) {
      const existingPreset = this.presets.find(preset => preset.name === presetName)
      if (existingPreset) {
        if (existingPreset.isDefault) {
          const saveAnyway: boolean = await this.dialog.open(ConfirmDialogComponent, {
            hasBackdrop: true,
            disableClose: true,
            data: {
              confirmText: this.translate.instant('presets.yesSave'),
              cancelText: this.translate.instant('presets.noCancel'),
              text: this.translate.instant('presets.defaultNameExists')
            }
          }).afterClosed().toPromise()
          if (!saveAnyway) return this.savePreset(presetName)
        } else {
          const overwrite: boolean = await this.dialog.open(ConfirmDialogComponent, {
            hasBackdrop: true,
            disableClose: true,
            data: {
              confirmText: this.translate.instant('presets.yesOverwrite'),
              cancelText: this.translate.instant('presets.noCancel'),
              text: this.translate.instant('presets.nameExists')
            }
          }).afterClosed().toPromise()
          if (!overwrite) return this.savePreset(presetName)
        }
      }
      this.presetSaved.emit(presetName)
    }
  }

  async deletePreset () {
    const shouldDelete = await this.dialog.open(ConfirmDialogComponent, {
      hasBackdrop: true,
      disableClose: true,
      data: {
        confirmText: this.translate.instant('presets.yesRemove'),
        cancelText: this.translate.instant('presets.noCancel'),
        text: this.translate.instant('presets.removeConfirmation')
      }
    }).afterClosed().toPromise()

    if (shouldDelete) {
      this.presetDeleted.emit()
    }
  }

  get orderedPresets () {
    return this.presets.sort((a, b) => a.isDefault ? 1 : a.name.localeCompare(b.name))
  }
}
