import {
  Component,
  OnInit,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  HostBinding,
  HostListener,
  ChangeDetectionStrategy,
  ChangeDetectorRef
} from '@angular/core'
import { UtilitiesService } from '../../services/utilities.service'
import { ColorsService } from '../../services/colors.service'

/**
 * Searchable dropdown with windowed rendering.
 *
 * API mirrors eqm-dropdown (items, labelParam, selectedItem, itemSelected)
 * but only the on-screen slice of rows is ever in the DOM (fixed row height +
 * translateY'd window inside a full-height spacer — no CDK dependency), so
 * it comfortably handles 5000+ items (e.g. the AutoEQ headphone browser).
 */
@Component({
  selector: 'eqm-virtual-dropdown',
  templateUrl: './virtual-dropdown.component.html',
  styleUrls: [ './virtual-dropdown.component.scss' ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class VirtualDropdownComponent implements OnInit {
  constructor (
    public utils: UtilitiesService,
    public colors: ColorsService,
    public ref: ElementRef,
    private readonly changeRef: ChangeDetectorRef
  ) {}

  public _items: any[] = []
  @Input()
  get items () {
    return this._items
  }

  set items (newItems) {
    if (!newItems || !Array.isArray(newItems)) return
    this.searchText = undefined
    this._items = newItems
    this.updateFilteredItems()
    this.updateWindow()
  }

  @Output() refChanged = new EventEmitter<VirtualDropdownComponent>()
  @HostBinding('class.enabled') @Input() enabled = true
  @Input() selectedItem: any = null
  @Output() selectedItemChange = new EventEmitter<any>()
  @Input() labelParam = 'text'
  @Input() numberOfVisibleItems = 6
  @Input() placeholder = 'Select item'
  @Input() noItemsPlaceholder = 'No items'
  @Input() searchPlaceholder = 'Search'
  @Input() closeOnSelect = true
  @Input() searchable = true
  @Input() itemHeight = 25
  @Input() forceDirection?: 'down' | 'up'
  @Output() itemSelected = new EventEmitter<any>()

  @ViewChild('container', { read: ElementRef, static: true }) container!: ElementRef
  @ViewChild('panel', { read: ElementRef, static: true }) panel!: ElementRef
  @ViewChild('viewport', { read: ElementRef, static: true }) viewport!: ElementRef

  shown = false
  yCoordinate = 0
  direction: 'down' | 'up' = 'down'
  searchText?: string

  public padding = 5
  public searchRowHeight = 32
  private readonly overscan = 3

  filteredItems: any[] = []
  visibleItems: any[] = []
  translateY = 0
  private scrollTop = 0

  async ngOnInit () {
    if (!this.items) this.items = []
    this.updateFilteredItems()
    this.updateWindow()
    this.setDimensions()
    this.calculateYCoordinate()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of [ ...Array(3) ]) {
      await this.utils.delay(100)
      this.calculateYCoordinate()
    }
    this.refChanged.emit(this)
  }

  get viewportHeight () {
    const count = this.filteredItems.length
    const visible = Math.min(this.numberOfVisibleItems, count)
    return visible * this.itemHeight + (count > this.numberOfVisibleItems ? this.itemHeight / 2 : 0)
  }

  get totalHeight () {
    return this.filteredItems.length * this.itemHeight
  }

  get panelHeight () {
    const listHeight = this.filteredItems.length ? this.viewportHeight : this.itemHeight
    return listHeight + (this.searchable ? this.searchRowHeight : 0) + this.padding
  }

  setDimensions () {
    const inputEl = this.container.nativeElement
    const panelEl = this.panel.nativeElement

    const inputWidth = inputEl.offsetWidth

    panelEl.style.width = `${inputWidth}px`
  }

  calculateYCoordinate () {
    const body = document.body
    const html = document.documentElement
    const viewHeight = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight)
    const preferredDirection = 'down'
    this.direction = preferredDirection
    const inputEl: HTMLElement = this.container.nativeElement

    const inputHeight = inputEl.offsetHeight
    const inputRect = inputEl.getBoundingClientRect()
    const scale = inputRect.width / inputEl.offsetWidth

    const panelHeight = this.panelHeight

    const downYScaled = inputRect.y / scale + inputHeight + this.padding / 2
    const downYNotScaled = inputRect.y + inputHeight + this.padding / 2
    const downSpaceLeft = viewHeight - (downYNotScaled + panelHeight)

    const upYScaled = inputRect.top / scale - panelHeight - this.padding
    const upYNotScaled = inputRect.top - panelHeight - this.padding
    const upSpaceLeft = upYNotScaled

    this.direction = this.forceDirection ?? (downSpaceLeft > upSpaceLeft ? 'down' : 'up')
    const y = this.direction === 'down' ? downYScaled : upYScaled

    this.yCoordinate = Math.round(y)
  }

  async toggle (event: MouseEvent) {
    event.stopPropagation()
    if (this.shown) {
      this.close()
    } else {
      this.open()
    }
  }

  async open () {
    if (this.enabled && !this.shown && this.items.length) {
      this.searchText = undefined
      this.updateFilteredItems()
      this.calculateYCoordinate()
      this.setDimensions()
      this.shown = true
      this.changeRef.detectChanges()
      this.scrollToSelectedItem()
      this.syncScroll()
      this.focusSearchInput()
    }
  }

  async close () {
    if (this.enabled && this.shown) {
      this.shown = false
      this.searchText = undefined
      this.updateFilteredItems()
      this.updateWindow()
      this.changeRef.detectChanges()
    }
  }

  selectItem (item: any) {
    this.selectedItem = item
    this.selectedItemChange.emit(item)
    this.itemSelected.emit(item)
    if (this.closeOnSelect) {
      this.close()
    } else {
      this.changeRef.detectChanges()
    }
  }

  onSearchChanged (text?: string) {
    this.searchText = text || undefined
    this.updateFilteredItems()
    const viewportEl: HTMLElement = this.viewport.nativeElement
    viewportEl.scrollTop = 0
    this.scrollTop = 0
    this.updateWindow()
    // Panel height depends on the number of matches — keep position in sync
    this.calculateYCoordinate()
    this.changeRef.detectChanges()
  }

  onScroll () {
    this.syncScroll()
  }

  onClickedOutside () {
    if (this.shown) {
      this.close()
    }
  }

  @HostListener('document:keydown', [ '$event' ])
  keydown (event: KeyboardEvent) {
    if (this.enabled && this.shown && event.key === 'Escape') {
      this.close()
    }
  }

  private syncScroll () {
    const viewportEl: HTMLElement = this.viewport.nativeElement
    this.scrollTop = viewportEl.scrollTop
    this.updateWindow()
    this.changeRef.detectChanges()
  }

  private updateFilteredItems () {
    const query = this.searchable && this.searchText ? this.searchText.toLowerCase() : undefined
    if (query) {
      this.filteredItems = this._items.filter(item =>
        String(item?.[this.labelParam] ?? '').toLowerCase().includes(query)
      )
    } else {
      this.filteredItems = this._items
    }
  }

  private updateWindow () {
    const count = this.filteredItems.length
    const start = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.overscan)
    const end = Math.min(count, Math.ceil((this.scrollTop + this.viewportHeight) / this.itemHeight) + this.overscan)
    this.visibleItems = this.filteredItems.slice(start, end)
    this.translateY = start * this.itemHeight
  }

  private scrollToSelectedItem () {
    if (!this.selectedItem) return
    const index = this.filteredItems.indexOf(this.selectedItem)
    if (index < 0) return
    const viewportEl: HTMLElement = this.viewport.nativeElement
    viewportEl.scrollTop = Math.max(0, index * this.itemHeight - (this.viewportHeight - this.itemHeight) / 2)
  }

  private focusSearchInput () {
    if (!this.searchable) return
    const input: HTMLInputElement | null = this.panel.nativeElement.querySelector('input')
    if (input) {
      input.focus()
    }
  }

  trackByItem (index: number, item: any) {
    return item
  }
}
