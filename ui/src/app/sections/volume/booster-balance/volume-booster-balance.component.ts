import { Component, OnInit, EventEmitter, Output } from '@angular/core'
import { UIService } from '../../../services/ui.service'

@Component({
  selector: 'eqm-volume-booster-balance',
  templateUrl: './volume-booster-balance.component.html',
  styleUrls: [ './volume-booster-balance.component.scss' ]
})
export class VolumeBoosterBalanceComponent implements OnInit {
  hide = false
  replaceKnobsWithSliders = false
  @Output() visibilityToggled = new EventEmitter()
  constructor (
    public ui: UIService
  ) { }

  get height () {
    // Cards are stacked vertically (Volume above Balance) in both modes now,
    // so height scales with how many features are enabled. Matches the fixed
    // card heights in the stylesheet + the 8px gap between cards + the
    // .cards 8px top/bottom padding (16).
    const cards =
      (this.ui.settings.volumeFeatureEnabled ? 1 : 0) +
      (this.ui.settings.balanceFeatureEnabled ? 1 : 0)
    if (cards === 0) return 0
    const cardHeight = this.replaceKnobsWithSliders ? 80 : 88
    const gap = 8
    const verticalPadding = 16
    return cards * cardHeight + Math.max(cards - 1, 0) * gap + verticalPadding
  }

  async ngOnInit () {
    this.syncUISettings()
    this.setupListeners()
  }

  async syncUISettings () {
    const uiSettings = await this.ui.getSettings()
    this.replaceKnobsWithSliders = !!uiSettings.replaceKnobsWithSliders
  }

  setupListeners () {
    this.ui.settingsChanged.subscribe(uiSettings => {
      this.replaceKnobsWithSliders = !!uiSettings.replaceKnobsWithSliders
    })
  }

  async toggleVisibility () {
    this.hide = !this.hide
    this.visibilityToggled.emit()
  }
}
