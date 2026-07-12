import { Component, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { ButtonOption, Options } from 'src/app/components/options/options.component'
import { ApplicationService, Info } from 'src/app/services/app.service'
import { ConstantsService } from 'src/app/services/constants.service'
import packageJson from '../../../../package.json'
import { UIService } from '../../services/ui.service'
import { TranslateService } from '../../services/translate.service'

@Component({
  selector: 'eqm-help',
  templateUrl: './help.component.html',
  styleUrls: [ './help.component.scss' ]
})
export class HelpComponent implements OnInit, OnDestroy {
  private readonly faqButton: ButtonOption = {
    type: 'button',
    label: '',  // set by applyTranslations()
    action: this.faq.bind(this)
  }

  private readonly reportBugButton: ButtonOption = {
    type: 'button',
    label: '',  // set by applyTranslations()
    action: this.reportBug.bind(this)
  }

  options: Options = [
    [
      this.faqButton,
      this.reportBugButton
    ]
  ]

  constructor (
    public app: ApplicationService,
    public CONST: ConstantsService,
    public ui: UIService,
    private readonly translate: TranslateService
  ) {
    this.applyTranslations()
  }

  // Options arrays carry TS-built labels — retranslate them in place when
  // the user switches language
  private applyTranslations () {
    this.faqButton.label = this.translate.instant('help.faq')
    this.reportBugButton.label = this.translate.instant('help.reportBug')
  }

  get uiVersion () {
    const location = this.translate.instant(this.ui.isLocal ? 'help.local' : 'help.remote')
    return `${packageJson.version} (${location})`
  }

  info: Info
  private localeChangedSubscription: Subscription
  ngOnInit () {
    this.localeChangedSubscription = this.translate.localeChanged
      .subscribe(() => this.applyTranslations())
    this.fetchInfo()
  }

  ngOnDestroy () {
    this.localeChangedSubscription?.unsubscribe()
  }

  async fetchInfo () {
    this.info = await this.app.getInfo()
  }

  reportBug () {
    this.app.openURL(this.CONST.BUG_REPORT_URL)
  }

  faq () {
    this.app.openURL(this.CONST.FAQ_URL)
  }
}
