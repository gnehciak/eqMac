import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
  Inject,
  Optional
} from '@angular/core'
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog'
import { ColorsService } from '@eqmac/components'
import { AutoEQService, AutoEQSearchResult } from './autoeq.service'
import { ToastService } from 'src/app/services/toast.service'
import { TranslateService } from 'src/app/services/translate.service'

export interface AutoEQBrowserDialogData {
  title?: string
}

/**
 * AutoEQ headphone preset browser (MatDialog).
 *
 * Search runs native-side over the bundled ~8850 entry database (capped at
 * 200 rows per response), the result list is windowed the same way as
 * eqm-virtual-dropdown (fixed row height + translateY'd slice inside a
 * full-height spacer), so the DOM stays tiny either way.
 */
@Component({
  selector: 'eqm-autoeq-browser',
  templateUrl: './autoeq-browser.component.html',
  styleUrls: [ './autoeq-browser.component.scss' ]
})
export class AutoEQBrowserComponent implements OnInit, OnDestroy {
  title = ''

  searchQuery = ''
  results: AutoEQSearchResult[] = []
  total = 0
  selected: AutoEQSearchResult | null = null

  /** First search still in flight — native is gunzipping the database */
  loading = true
  /** Native reported the database as unavailable */
  unavailable = false
  /** An /apply request is in flight */
  applying = false
  private synced = false

  // MARK: - Windowed list

  readonly rowHeight = 36
  readonly visibleRows = 7
  private readonly overscan = 3
  visibleResults: AutoEQSearchResult[] = []
  translateY = 0
  private scrollTop = 0

  @ViewChild('viewport', { static: false }) viewport?: ElementRef

  private readonly searchDebounceMs = 200
  private searchDebounceTimer: any = null
  /** Discards responses of superseded searches */
  private searchEpoch = 0

  constructor (
    public service: AutoEQService,
    public colors: ColorsService,
    public toast: ToastService,
    private readonly translate: TranslateService,
    private readonly change: ChangeDetectorRef,
    public dialogRef: MatDialogRef<AutoEQBrowserComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data?: AutoEQBrowserDialogData
  ) {
    this.title = this.translate.instant('autoeq.title')
    if (this.data && this.data.title) {
      this.title = this.data.title
    }
  }

  ngOnInit () {
    // Initial (empty) search doubles as the lazy database warm-up
    this.search()
  }

  get viewportHeight () {
    return this.visibleRows * this.rowHeight
  }

  get totalHeight () {
    return this.results.length * this.rowHeight
  }

  get statusText () {
    if (this.unavailable) return this.translate.instant('autoeq.unavailable')
    if (this.loading) return this.translate.instant('autoeq.loading')
    if (!this.results.length) return this.translate.instant('autoeq.noMatches')
    if (this.total > this.results.length) {
      return this.translate.instant('autoeq.showingFirst', { shown: this.results.length, total: this.total })
    }
    return this.total === 1
      ? this.translate.instant('autoeq.oneMatch')
      : this.translate.instant('autoeq.matches', { total: this.total })
  }

  onSearchChanged (query?: string) {
    this.searchQuery = query || ''
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer)
    this.searchDebounceTimer = setTimeout(() => {
      this.searchDebounceTimer = null
      this.search()
    }, this.searchDebounceMs)
  }

  private async search () {
    const epoch = ++this.searchEpoch
    if (!this.synced) {
      this.loading = true
      this.change.detectChanges()
    }
    try {
      const { results, total } = await this.service.search(this.searchQuery)
      if (epoch !== this.searchEpoch) return
      this.synced = true
      this.loading = false
      this.unavailable = false
      this.results = results || []
      this.total = typeof total === 'number' ? total : this.results.length
      if (this.selected && !this.results.some(result => result.id === this.selected.id)) {
        this.selected = null
      }
      this.resetScroll()
      this.updateWindow()
    } catch (err) {
      if (epoch !== this.searchEpoch) return
      this.loading = false
      this.unavailable = !this.synced
      this.results = []
      this.total = 0
      this.selected = null
      this.updateWindow()
    }
    this.change.detectChanges()
  }

  private resetScroll () {
    this.scrollTop = 0
    const viewportEl: HTMLElement | undefined = this.viewport && this.viewport.nativeElement
    if (viewportEl) viewportEl.scrollTop = 0
  }

  onScroll () {
    const viewportEl: HTMLElement | undefined = this.viewport && this.viewport.nativeElement
    if (!viewportEl) return
    this.scrollTop = viewportEl.scrollTop
    this.updateWindow()
    this.change.detectChanges()
  }

  private updateWindow () {
    const count = this.results.length
    const start = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - this.overscan)
    const end = Math.min(count, Math.ceil((this.scrollTop + this.viewportHeight) / this.rowHeight) + this.overscan)
    this.visibleResults = this.results.slice(start, end)
    this.translateY = start * this.rowHeight
  }

  select (result: AutoEQSearchResult) {
    this.selected = result
    this.change.detectChanges()
  }

  /** Writes the profile into the 'manual' preset (audition) */
  async apply () {
    if (!this.selected || this.applying) return
    this.applying = true
    this.change.detectChanges()
    try {
      const message = await this.service.apply(this.selected.id)
      this.toast.show({
        type: 'success',
        message: typeof message === 'string' ? message : this.translate.instant('autoeq.applied', { name: this.selected.name })
      })
    } catch (err) {
      // DataService already toasts the native error
    }
    this.applying = false
    this.change.detectChanges()
  }

  /** Persists the profile as a new user preset named after the headphone */
  async saveAsPreset () {
    if (!this.selected || this.applying) return
    this.applying = true
    this.change.detectChanges()
    try {
      await this.service.apply(this.selected.id, { saveAsPreset: true })
      this.toast.show({
        type: 'success',
        message: this.translate.instant('autoeq.savedAsPreset', { name: this.selected.name })
      })
    } catch (err) {
      // DataService already toasts the native error
    }
    this.applying = false
    this.change.detectChanges()
  }

  close () {
    this.dialogRef.close()
  }

  trackById (index: number, result: AutoEQSearchResult) {
    return result.id
  }

  ngOnDestroy () {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer)
      this.searchDebounceTimer = null
    }
    // Discard any in-flight search response
    this.searchEpoch++
  }
}
