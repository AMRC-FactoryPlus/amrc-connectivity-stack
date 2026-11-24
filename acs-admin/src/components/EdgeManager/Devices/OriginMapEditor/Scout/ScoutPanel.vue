<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -
  - The Addresses panel: Edge Scout in the origin map editor.
  -
  - It shows the connection's latest scan beside the schema tree, with
  - Scan, Re-scan and Stop, the change bar, search and filters. The
  - operator uses an address for the selected metric, drags it onto any
  - metric in the schema tree, or ticks several and maps them together.
  - Nothing here writes the origin map. The editor does, and only Save
  - stores it.
  -->

<template>
  <div class="flex flex-col h-full min-h-0 gap-2 text-sm">
    <!-- Header -->
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="flex items-center gap-2 text-gray-500">
          <i class="fa-solid fa-sitemap text-xs"></i>
          <div class="text-xs font-bold uppercase tracking-wide">Addresses</div>
        </div>
        <div class="text-xs text-gray-500 mt-0.5 truncate" :title="subtitle">{{ subtitle }}</div>
      </div>
      <Button variant="ghost" size="plain" class="size-7 shrink-0 text-gray-500" title="Close the Addresses panel"
          @click="$emit('close')">
        <i class="fa-solid fa-xmark"></i>
      </Button>
    </div>

    <!-- Pick mode -->
    <div v-if="pickFor" class="flex items-center justify-between gap-2 rounded-md border border-gray-800 bg-gray-800 px-3 py-2 text-xs text-white">
      <span>Choose the address for <span class="font-semibold">{{ pickFor }}</span>.</span>
      <button type="button" class="underline" @click="$emit('cancel-pick')">Cancel</button>
    </div>

    <!-- State banner -->
    <div v-if="banner" class="rounded-md border px-3 py-2 text-xs" :class="tone_class(banner.tone)" role="status">
      <div class="flex items-start gap-2">
        <i v-if="banner.tone === 'busy'" class="fa-solid fa-circle-notch fa-spin mt-0.5"></i>
        <span class="flex-1">{{ banner.text }}</span>
      </div>
      <div v-if="st.state === 'refused' && st.code === 'BUSY'" class="mt-1.5">
        <button type="button" class="underline" @click="scout.forget()">Follow the running scan</button>
      </div>
    </div>
    <div v-if="untrusted" class="rounded-md border px-3 py-2 text-xs" :class="tone_class('warn')" role="status">{{ UNTRUSTED_TEXT }}</div>
    <div v-if="sendError" class="rounded-md border px-3 py-2 text-xs" :class="tone_class('error')">{{ sendError }}</div>

    <!-- Actions -->
    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="!stoppable" size="xs" class="gap-1.5"
          :disabled="!startable"
          :title="startable ? scanTitle : (st.state === 'no_permission' ? 'Needs the Scan device addresses permission.' : '')"
          @click="start()">
        <i class="fa-solid fa-magnifying-glass text-xs"></i>
        {{ scanLabel }}
      </Button>
      <Button v-else size="xs" variant="outline" class="gap-1.5" @click="scout.cancel()">
        <i class="fa-solid fa-stop text-xs"></i>
        Stop
      </Button>
      <Button v-if="optionFields.length" size="xs" variant="outline" class="gap-1.5"
          :aria-expanded="showOptions" @click="showOptions = !showOptions">
        <i class="fa-solid fa-sliders text-xs"></i>
        Options
      </Button>
      <Button v-if="checked.size" size="xs" variant="outline" class="gap-1.5 ml-auto"
          @click="$emit('map', checked_items)">
        Map selected ({{ checked.size }})
      </Button>
    </div>

    <!-- Scan options, from the DriverDef's scout.options schema -->
    <div v-if="showOptions && optionFields.length" class="grid gap-2 rounded-md border border-gray-200 bg-gray-50 p-2">
      <label v-for="f in optionFields" :key="f.key" class="grid gap-1 text-xs">
        <span class="font-medium text-gray-700">{{ f.title }}</span>
        <input v-if="f.kind === 'boolean'" type="checkbox" class="size-4 accent-gray-800"
            :checked="!!options[f.key]" @change="options[f.key] = $event.target.checked"/>
        <input v-else-if="f.kind === 'number'" type="number"
            class="h-8 rounded border border-gray-300 px-2"
            :value="options[f.key]"
            @input="set_number(f.key, $event.target.value)"/>
        <input v-else
            class="h-8 rounded border border-gray-300 px-2"
            :value="f.kind === 'list' ? (options[f.key] ?? []).join(', ') : options[f.key]"
            :placeholder="f.kind === 'list' ? 'Separate values with commas' : ''"
            @input="set_text(f, $event.target.value)"/>
        <span v-if="f.description" class="text-gray-500">{{ f.description }}</span>
      </label>
    </div>

    <!-- Banners about the snapshot itself -->
    <div v-if="loadError" class="rounded-md border px-3 py-2 text-xs" :class="tone_class('error')">
      The scan result could not be read. {{ loadError }}
    </div>
    <div v-if="truncatedText" class="rounded-md border px-3 py-2 text-xs" :class="tone_class('warn')">{{ truncatedText }}</div>
    <div v-if="stale" class="rounded-md border px-3 py-2 text-xs" :class="tone_class('warn')">
      The connection's settings changed after this scan. Scan again to see the device as it is now.
    </div>
    <div v-if="previousBanner" class="rounded-md border px-3 py-2 text-xs" :class="tone_class('info')">{{ previousBanner }}</div>

    <template v-if="index">
      <ScoutChangeBar :changes="changes" :missing="missing" :active="changeFilter"
          @filter="f => changeFilter = f"
          @select-metric="p => $emit('select-metric', p)"/>

      <!-- Search and filters -->
      <div class="flex flex-col gap-1.5">
        <input v-model="query" type="search"
            class="h-8 w-full rounded-md border border-gray-300 px-2 text-xs"
            placeholder="Search names, addresses, descriptions and units"
            aria-label="Search the scan"/>
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          <button v-for="f in FILTERS" :key="f.key" type="button"
              class="rounded-full border px-2 py-0.5"
              :class="filters[f.key] ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300 text-gray-600 hover:border-gray-400'"
              :aria-pressed="filters[f.key]"
              :disabled="f.key === 'new' && !changes"
              @click="filters[f.key] = !filters[f.key]">{{ f.label }}</button>
          <select v-model="typeFilter" class="h-6 rounded border border-gray-300 px-1 text-xs" aria-label="Type">
            <option value="">Any type</option>
            <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
          </select>
          <span v-if="searchActive" class="ml-auto text-gray-500">{{ matchText }}</span>
        </div>
      </div>

      <ScoutTree ref="tree" class="border border-gray-200 bg-white"
          :index="index" :rows="rows" :usage="usageMap" :changes="changes"
          :checked="checked" :highlight="highlight" :focus="focus"
          selectable
          :can-use="!!pickFor || !!selectedMetric"
          :can-branch="branchable"
          :use-title="pickFor ? `Use this address for ${pickFor}` : 'Use this address for the selected metric'"
          :empty-text="searchActive ? 'Nothing matches.' : 'The scan found no addresses.'"
          @toggle="toggle" @check="check" @focus="id => focus = id"
          @select="on_select" @use="use" @branch="branch"/>
      <p class="text-[11px] text-gray-400">
        Drag an address onto a metric in the schema tree, or press Enter to use it for the selected metric.
      </p>
    </template>
    <div v-else-if="loading" class="flex items-center gap-2 text-xs text-gray-500 py-4">
      <i class="fa-solid fa-circle-notch fa-spin"></i> Loading the scan
    </div>
  </div>
</template>

<script>
import { Button } from '@/components/ui/button'
import ScoutTree from './ScoutTree.vue'
import ScoutChangeBar from './ScoutChangeBar.vue'
import { UNTRUSTED_TEXT, state_banner } from '@/lib/scout/text.js'
import {
  ancestors,
  can_start,
  can_stop,
  count_text,
  item_key,
  mapped_but_missing,
  metric_key,
  search,
  truncated_text,
  usage,
  visible_rows,
  when_text,
} from '@/lib/scout/model.js'

const FILTERS = [
  { key: 'values', label: 'Values only' },
  { key: 'unmapped', label: 'Not mapped' },
  { key: 'new', label: 'New since last scan' },
  { key: 'writable', label: 'Writable' },
]

export default {
  name: 'ScoutPanel',

  components: { Button, ScoutTree, ScoutChangeBar },

  props: {
    /* From useScout. */
    scout:          { type: Object, required: true },
    /* The connection's DriverDef. */
    driver:         { type: Object, default: null },
    driverName:     { type: String, default: null },
    /* `mqtt` or `sim`, for the wording of an empty scan. */
    kind:           { type: String, default: null },
    /* This device's live origin map, saved or not. */
    model:          { type: Object, default: () => ({}) },
    /* Every device on the connection, as {name, model}. */
    devices:        { type: Array, default: () => [] },
    /* The editor's selected metric, for the reverse view. */
    selectedMetric: { type: Object, default: null },
    /* The metric's name while Pick from scan is waiting. */
    pickFor:        { type: String, default: null },
  },

  emits: ['use', 'map', 'close', 'select-metric', 'cancel-pick'],

  data () {
    return {
      FILTERS,
      UNTRUSTED_TEXT,
      query: '',
      debounced: '',
      filters: { values: false, unmapped: false, new: false, writable: false },
      typeFilter: '',
      changeFilter: null,
      expanded: new Set(),
      checked: new Set(),
      focus: null,
      showOptions: false,
      options: {},
    }
  },

  computed: {
    st () { return this.scout.state.value },
    /* A status entry exists but another Edge Agent wrote it. */
    untrusted () { return !!this.scout.entry.value && !this.scout.trusted.value },
    status () { return this.scout.status.value },
    index () { return this.scout.current_index.value },
    changes () { return this.scout.changes.value },
    loading () { return this.scout.loading.current },
    loadError () { return this.scout.load_error.value },
    sendError () { return this.scout.send_error.value },
    form () { return this.driver?.scout?.address_form ?? 'exact' },

    banner () {
      return state_banner(this.st, {
        driver: this.driverName,
        kind: this.kind,
        status: this.status,
        now: this.scout.tick.value,
        options: this.snapshotOptions,
      })
    },

    subtitle () {
      const cur = this.status?.current
      if (!cur) return this.driver?.scout?.title ?? 'Not scanned yet'
      return `${count_text(cur.items)}, scanned ${when_text(cur.finished)}`
    },

    startable () {
      return can_start(this.st.state) && this.scout.can_scout.value !== false
    },

    stoppable () {
      return can_stop(this.st.state) && this.scout.can_scout.value !== false
    },

    branchable () {
      return this.startable && !!this.status?.current
    },

    scanLabel () {
      if (['failed', 'cancelled', 'interrupted', 'waiting', 'refused'].includes(this.st.state)) return 'Try again'
      return this.status?.current ? 'Re-scan' : 'Scan'
    },

    scanTitle () {
      return this.driver?.scout?.title ?? 'Scan the device for addresses'
    },

    snapshotOptions () {
      return this.scout.snapshots.current?.header?.options ?? null
    },

    truncatedText () {
      const cur = this.status?.current
      return cur?.truncated ? truncated_text(cur.reason) : null
    },

    stale () {
      const s = this.status
      return !!(s?.current?.config_hash && s.config_hash && s.current.config_hash !== s.config_hash)
    },

    /* While a scan runs, or after one failed, the last good scan stays
     * browsable under a note. */
    previousBanner () {
      if (!this.status?.current) return null
      if (['queued', 'running'].includes(this.st.state))
        return `Showing the scan of ${when_text(this.status.current.finished)} until this one finishes.`
      return null
    },

    optionFields () {
      const props = this.driver?.scout?.options?.properties ?? {}
      return Object.entries(props).map(([key, spec]) => ({
        key,
        title: spec?.title ?? key,
        description: spec?.description ?? null,
        kind: spec?.type === 'boolean' ? 'boolean'
          : spec?.type === 'integer' || spec?.type === 'number' ? 'number'
            : spec?.type === 'array' ? 'list'
              : 'text',
      }))
    },

    usageMap () {
      return usage(this.devices, this.form, this.index)
    },

    missing () {
      if (!this.index || !this.status?.current) return null
      return mapped_but_missing(this.model, this.index, this.status.current, this.form)
    },

    types () {
      if (!this.index) return []
      return [...new Set(this.index.items.map(i => i.type).filter(Boolean))].sort()
    },

    found () {
      return this.index ? search(this.index, this.debounced) : null
    },

    searchActive () {
      return this.debounced.trim() !== ''
    },

    matchText () {
      const n = this.found?.matches.size ?? 0
      return `${n.toLocaleString('en-GB')} match${n === 1 ? '' : 'es'}`
    },

    filtering () {
      return this.searchActive || this.typeFilter
        || Object.values(this.filters).some(Boolean)
        || this.changeFilter === 'new' || this.changeFilter === 'changed'
    },

    /* The items to keep when any search or filter is on. */
    keep () {
      if (!this.index || !this.filtering) return null
      const f = this.filters
      const c = this.changes
      const out = new Set()
      for (const it of this.index.items) {
        if (this.searchActive && !this.found.matches.has(it.id)) continue
        if (f.values && it.kind !== 'value') continue
        if (f.writable && !(it.access ?? '').includes('w')) continue
        if (this.typeFilter && it.type !== this.typeFilter) continue
        if (f.unmapped && (it.kind !== 'value' || this.usageMap.has(item_key(it)))) continue
        if ((f.new || this.changeFilter === 'new') && !c?.added.has(it.id)) continue
        if (this.changeFilter === 'changed' && !c?.changed.has(it.id) && !c?.renamed.has(it.id)) continue
        out.add(it.id)
      }
      return out
    },

    rows () {
      if (!this.index) return []
      return visible_rows(this.index, { expanded: this.expanded, keep: this.keep })
    },

    /* The reverse view: the selected metric's address in the tree. */
    highlight () {
      const metric = this.selectedMetric?.model
      if (!this.index || !metric) return null
      const key = metric_key(metric, this.form, this.index)
      return key ? (this.index.by_key.get(key)?.id ?? null) : null
    },

    checked_items () {
      return [...this.checked].map(id => this.index?.by_id.get(id)).filter(Boolean)
    },
  },

  watch: {
    query (q) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => { this.debounced = q }, 150)
    },

    highlight: {
      handler (id) { if (id) this.reveal(id) },
      immediate: true,
    },

    /* A new snapshot keeps open folders that still exist, and drops
     * ticks for items that are gone. */
    index (idx) {
      if (!idx) return
      this.expanded = new Set([...this.expanded].filter(id => idx.by_id.has(id)))
      this.checked = new Set([...this.checked].filter(id => idx.by_id.has(id)))
      if (this.highlight) this.reveal(this.highlight)
    },

    'driver.scout.options': {
      handler () { this.reset_options() },
      immediate: true,
    },
  },

  beforeUnmount () {
    clearTimeout(this.debounceTimer)
  },

  methods: {
    tone_class (tone) {
      return {
        info: 'border-gray-200 bg-gray-50 text-gray-700',
        busy: 'border-blue-200 bg-blue-50 text-blue-900',
        warn: 'border-amber-200 bg-amber-50 text-amber-900',
        error: 'border-red-200 bg-red-50 text-red-800',
      }[tone] ?? 'border-gray-200 bg-gray-50 text-gray-700'
    },

    reset_options () {
      const props = this.driver?.scout?.options?.properties ?? {}
      const out = {}
      for (const [k, spec] of Object.entries(props))
        if (spec && 'default' in spec) out[k] = spec.default
      this.options = out
    },

    set_number (key, raw) {
      if (raw === '') delete this.options[key]
      else this.options[key] = Number(raw)
    },

    set_text (f, raw) {
      if (f.kind === 'list') {
        const list = raw.split(',').map(s => s.trim()).filter(Boolean)
        if (list.length) this.options[f.key] = list
        else delete this.options[f.key]
      }
      else if (raw === '') delete this.options[f.key]
      else this.options[f.key] = raw
    },

    start () {
      this.scout.start({ options: { ...this.options } })
    },

    toggle (id) {
      const next = new Set(this.expanded)
      next.has(id) ? next.delete(id) : next.add(id)
      this.expanded = next
    },

    check (id) {
      const next = new Set(this.checked)
      next.has(id) ? next.delete(id) : next.add(id)
      this.checked = next
    },

    on_select (id) {
      /* In pick mode a click chooses. Otherwise it only moves the focus,
       * so browsing never changes a metric. */
      if (this.pickFor && this.index.by_id.get(id)?.kind === 'value') this.use(id)
    },

    use (id) {
      const item = this.index?.by_id.get(id)
      if (item?.kind === 'value') this.$emit('use', item)
    },

    branch (id) {
      const item = this.index?.by_id.get(id)
      if (item) this.scout.scan_branch(item)
    },

    /** Open the ancestors of an item and scroll to it. */
    reveal (id) {
      if (!this.index?.by_id.has(id)) return
      const next = new Set(this.expanded)
      for (const a of ancestors(this.index, id)) next.add(a)
      this.expanded = next
      this.focus = id
      this.$nextTick(() => this.$refs.tree?.scroll_to(id))
    },

    clear_checked () {
      this.checked = new Set()
    },
  },
}
</script>
