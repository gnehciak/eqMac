import { Component, OnInit, Inject, Input } from '@angular/core'
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog'
import { TranslateService } from '../../services/translate.service'

export interface ConfirmDialogData {
  text: string
  confirmText?: string
  cancelText?: string
}

@Component({
  selector: 'eqm-confirm-dialog',
  templateUrl: './confirm-dialog.component.html',
  styleUrls: [ './confirm-dialog.component.scss' ]
})
export class ConfirmDialogComponent implements OnInit {
  @Input() text: string
  @Input() confirmText: string
  @Input() onConfirm: () => any
  @Input() cancelText: string

  constructor (
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData,
    protected translate: TranslateService
  ) {
    this.confirmText = this.translate.instant('common.ok')
    this.cancelText = this.translate.instant('common.cancel')
  }

  ngOnInit () {
    if (this.data) {
      for (const [ key, value ] of Object.entries(this.data)) {
        this[key] = value || this[key]
      }
    }
  }

  cancel () {
    this.dialogRef.close(false)
  }

  confirm () {
    if (this.onConfirm && typeof this.onConfirm === 'function') {
      this.onConfirm()
    } else {
      this.dialogRef.close(true)
    }
  }
}
