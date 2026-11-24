<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -
  - The discovered address tree. A scan can list 50,000 items, so only the
  - rows in view are rendered. Rows are a fixed 28 px, which makes the
  - window a matter of arithmetic on the scroll position.
  -
  - Every string comes from the device, so it is rendered as text only.
  -->

<template>
  <div
      ref="scroller"
      class="relative flex-1 min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-gray-400 rounded"
      tabindex="0"
      role="tree"
      :aria-label="label"
      :aria-activedescendant="focus ? row_dom_id(focus) : undefined"
      @scroll="on_scroll"
      @keydown="on_key"
  >
    <div :style="{ height: `${rows.length * ROW_HEIGHT}px`, minWidth: '760px' }" class="relative">
      <div
          v-for="row in window"
          :key="row.id"
          :id="row_dom_id(row.id)"
          role="treeitem"
          :aria-level="row.depth + 1"
          :aria-expanded="row.has_children ? row.open : undefined"
          :aria-selected="focus === row.id"
          :draggable="is_value(row.id)"
          class="absolute left-0 right-0 flex items-center gap-2 pr-2 text-xs border-b border-gray-100 cursor-default select-none"
          :class="row_class(row)"
          :style="{ top: `${row.index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }"
          @click="on_click(row, $event)"
          @dblclick="is_usable(row.id) && $emit('use', row.id)"
          @dragstart="on_drag(row, $event)"
      >
        <input v-if="selectable && is_value(row.id)"
            type="checkbox"
            class="ml-1 size-3.5 shrink-0 accent-gray-800"
            :checked="checked.has(row.id)"
            :aria-label="`Select ${item(row.id).name}`"
            @click.stop="$emit('check', row.id)"
        />
        <span v-else-if="selectable" class="ml-1 w-3.5 shrink-0"></span>

        <!-- Name, indented by depth -->
        <div class="flex items-center gap-1 min-w-0 w-56 shrink-0" :style="{ paddingLeft: `${row.depth * 14}px` }">
          <button v-if="row.has_children"
              type="button"
              tabindex="-1"
              class="size-4 shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-700"
              :aria-label="row.open ? 'Close' : 'Open'"
              @click.stop="$emit('toggle', row.id)"
          >
            <i class="fa-solid fa-chevron-right text-[9px] transition-transform" :class="row.open ? 'rotate-90' : ''"></i>
          </button>
          <span v-else class="size-4 shrink-0"></span>
          <i class="fa-solid text-[10px] shrink-0"
              :class="item(row.id).kind === 'folder' ? 'fa-folder text-gray-400' : 'fa-tag text-gray-500'"></i>
          <span class="truncate" :title="item(row.id).name">{{ item(row.id).name || item(row.id).id }}</span>
          <i v-if="item(row.id).more"
              class="fa-solid fa-ellipsis text-[10px] shrink-0 text-gray-400"
              title="The scan did not list what is inside this. Scan this branch to see it."
              aria-label="Not fully listed"></i>
        </div>

        <!-- Address -->
        <span class="font-mono truncate w-56 shrink-0 text-gray-600" :title="address_text(row.id)">
          {{ address_text(row.id) }}
        </span>

        <span class="w-16 shrink-0 text-gray-500 truncate">{{ item(row.id).type ?? '' }}</span>
        <span class="w-6 shrink-0 text-gray-500">{{ item(row.id).access ?? '' }}</span>
        <span class="w-20 shrink-0 text-gray-400 font-mono truncate" :title="item(row.id).sample ?? ''">{{ item(row.id).sample ?? '' }}</span>

        <!-- Mapped-to chip -->
        <span v-if="mapped(row.id).length"
            class="shrink-0 max-w-40 truncate rounded-full bg-green-100 text-green-800 px-2 py-0.5"
            :title="mapped(row.id).map(m => `${m.device}: ${m.path.join(' / ')}`).join('\n')"
        >
          {{ chip_text(row.id) }}
        </span>

        <!-- Change badge -->
        <span v-if="change(row.id)"
            class="shrink-0 rounded px-1.5 py-0.5 font-medium"
            :class="change(row.id).class"
            :title="change(row.id).title"
        >{{ change(row.id).text }}</span>

        <span class="flex-1"></span>

        <!-- Row actions -->
        <button v-if="canBranch && is_branch(row.id)"
            type="button"
            tabindex="-1"
            class="shrink-0 hidden group-hover:inline rounded px-1.5 py-0.5 text-gray-600 hover:bg-gray-200"
            :class="focus === row.id ? '!inline' : ''"
            title="Scan this branch again"
            @click.stop="$emit('branch', row.id)"
        >Scan this branch</button>
        <button v-if="is_usable(row.id) && canUse"
            type="button"
            tabindex="-1"
            class="shrink-0 hidden group-hover:inline rounded px-1.5 py-0.5 text-gray-700 hover:bg-gray-800 hover:text-white"
            :class="focus === row.id ? '!inline' : ''"
            :title="useTitle"
            @click.stop="$emit('use', row.id)"
        >Use</button>
      </div>
    </div>
    <div v-if="!rows.length" class="p-4 text-center text-xs text-gray-400">{{ emptyText }}</div>
  </div>
</template>

<script>
import { ROW_HEIGHT } from '@/lib/scout/constants.js'
import { item_key } from '@/lib/scout/model.js'

/* Rows rendered beyond the visible area, so scrolling stays smooth. */
const OVERSCAN = 10

export default {
  name: 'ScoutTree',

  props: {
    index:      { type: Object, required: true },
    rows:       { type: Array, required: true },
    /* Item key to the devices and metrics that use it. */
    usage:      { type: Map, default: () => new Map() },
    /* The re-scan diff, or null. */
    changes:    { type: Object, default: null },
    checked:    { type: Set, default: () => new Set() },
    /* The item to highlight, from the selected metric. */
    highlight:  { type: String, default: null },
    focus:      { type: String, default: null },
    selectable: { type: Boolean, default: false },
    canUse:     { type: Boolean, default: false },
    canBranch:  { type: Boolean, default: false },
    /* Folders can be used too, for a picker asked for a folder. */
    useFolders: { type: Boolean, default: false },
    useTitle:   { type: String, default: 'Use this address for the selected metric' },
    label:      { type: String, default: 'Discovered addresses' },
    emptyText:  { type: String, default: 'Nothing to show.' },
  },

  emits: ['toggle', 'check', 'use', 'branch', 'focus', 'select'],

  data () {
    return { ROW_HEIGHT, top: 0, height: 400 }
  },

  computed: {
    position () {
      return new Map(this.rows.map((r, i) => [r.id, i]))
    },

    window () {
      const first = Math.max(0, Math.floor(this.top / ROW_HEIGHT) - OVERSCAN)
      const last = Math.min(this.rows.length, Math.ceil((this.top + this.height) / ROW_HEIGHT) + OVERSCAN)
      const out = []
      for (let i = first; i < last; i++) out.push({ ...this.rows[i], index: i })
      return out
    },
  },

  mounted () {
    this.measure()
    this.observer = new ResizeObserver(() => this.measure())
    this.observer.observe(this.$refs.scroller)
  },

  beforeUnmount () {
    this.observer?.disconnect()
  },

  methods: {
    measure () {
      this.height = this.$refs.scroller?.clientHeight || 400
    },

    on_scroll () {
      this.top = this.$refs.scroller.scrollTop
    },

    item (id) {
      return this.index.by_id.get(id)
    },

    is_value (id) {
      return this.item(id)?.kind === 'value'
    },

    /* A folder can be scanned again whether or not the scan listed its
     * children, because a folder at the depth cap, or one the driver was
     * not allowed to read, comes with `more` and no children. */
    is_branch (id) {
      const it = this.item(id)
      return it?.kind === 'folder' || it?.more === true
    },

    is_usable (id) {
      return this.is_value(id) || (this.useFolders && this.item(id)?.kind === 'folder')
    },

    row_dom_id (id) {
      return `scout-${this.$.uid}-row-${this.position.get(id)}`
    },

    address_text (id) {
      const it = this.item(id)
      if (typeof it.address !== 'string') return ''
      return it.path ? `${it.address}  ${it.path}` : it.address
    },

    mapped (id) {
      const it = this.item(id)
      return typeof it.address === 'string' ? (this.usage.get(item_key(it)) ?? []) : []
    },

    chip_text (id) {
      const list = this.mapped(id)
      const first = list[0]
      const name = first.path.at(-1)
      return list.length > 1 ? `${name} +${list.length - 1}` : name
    },

    change (id) {
      const c = this.changes
      if (!c) return null
      if (c.added.has(id)) return { text: 'New', class: 'bg-blue-100 text-blue-800', title: 'Not in the previous scan' }
      if (c.changed.has(id))
        return { text: 'Changed', class: 'bg-amber-100 text-amber-800', title: `Changed: ${c.changed.get(id).join(', ')}` }
      if (c.renamed.has(id)) return { text: 'Renamed', class: 'bg-gray-100 text-gray-700', title: 'Same address, new name' }
      return null
    },

    row_class (row) {
      return [
        'group',
        row.id === this.highlight ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : '',
        row.id === this.focus ? 'bg-gray-200/70' : 'hover:bg-gray-100',
      ]
    },

    on_click (row, event) {
      this.$emit('focus', row.id)
      this.$emit('select', row.id, event)
    },

    on_drag (row, event) {
      const it = this.item(row.id)
      event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData('application/x-acs-scout-item', it.id)
      event.dataTransfer.setData('text/plain', it.address ?? '')
    },

    /** Scroll a row into view. */
    scroll_to (id) {
      const i = this.position.get(id)
      const el = this.$refs.scroller
      if (i == null || !el) return
      const y = i * ROW_HEIGHT
      if (y < el.scrollTop || y + ROW_HEIGHT > el.scrollTop + el.clientHeight)
        el.scrollTop = Math.max(0, y - el.clientHeight / 2)
      this.top = el.scrollTop
    },

    focus_tree () {
      this.$refs.scroller?.focus()
    },

    /* Arrow keys move, Right and Left open and close, Enter uses the item
     * for the selected metric, Space ticks it for bulk mapping. These are
     * the keyboard equivalents of clicking and dragging. */
    on_key (event) {
      const i = this.focus != null ? this.position.get(this.focus) : -1
      const row = i >= 0 ? this.rows[i] : null
      const go = j => {
        const r = this.rows[Math.max(0, Math.min(this.rows.length - 1, j))]
        if (!r) return
        this.$emit('focus', r.id)
        this.$nextTick(() => this.scroll_to(r.id))
      }
      switch (event.key) {
        case 'ArrowDown': go(i + 1); break
        case 'ArrowUp': go(i - 1); break
        case 'Home': go(0); break
        case 'End': go(this.rows.length - 1); break
        case 'ArrowRight':
          if (row?.has_children && !row.open) this.$emit('toggle', row.id)
          else go(i + 1)
          break
        case 'ArrowLeft':
          if (row?.has_children && row.open) this.$emit('toggle', row.id)
          else if (row) {
            const parent = this.item(row.id).parent
            if (this.position.has(parent)) go(this.position.get(parent))
          }
          break
        case 'Enter':
          if (row && this.is_usable(row.id)) this.$emit('use', row.id)
          break
        case ' ':
          if (row && this.selectable && this.is_value(row.id)) this.$emit('check', row.id)
          break
        default:
          return
      }
      event.preventDefault()
    },
  },
}
</script>
