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
    // Matches the fixed card heights in the stylesheet + the .cards padding:
    // knob mode:       88px card row + 16px vertical padding            = 104
    // slider fallback: 80px * 2 stacked cards + 8px gap + 16px padding  = 184
    return this.replaceKnobsWithSliders ? 184 : 104
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
