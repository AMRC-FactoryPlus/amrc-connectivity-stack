<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The builder's side rail: a preview of what the items cover, with
     data strips for up to 8 devices across the window (or the last 24
     hours when there is none) and a warning for each quiet device, and
     a collapsed list of what the service will store. -->
<template>
  <div class="flex flex-col gap-4">
    <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-3">
      <div class="font-semibold">Preview</div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="text-xl font-semibold leading-7 tabular-nums">{{ devices.length }}</div>
          <div class="text-xs text-slate-500">{{ devices.length === 1 ? 'device' : 'devices' }}</div>
        </div>
        <div>
          <div class="text-xl font-semibold leading-7 tabular-nums">{{ metrics }}</div>
          <div class="text-xs text-slate-500">{{ metrics === 1 ? 'metric' : 'metrics' }}</div>
        </div>
      </div>
      <div v-if="!items.length" class="text-sm text-slate-500">Add devices or datasets to see what they cover.</div>
      <div v-else class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        <span class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>{{ online }} online</span>
        <span class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>{{ offline.length }} offline</span>
        <span v-if="unknownStatus" class="flex items-center gap-1.5"><span class="h-1.5 w-1.5 rounded-full bg-slate-200"></span>{{ unknownStatus }} unknown</span>
      </div>
      <div v-if="devices.length" class="flex flex-col gap-1.5">
        <div class="text-xs text-slate-500">{{ caption }}</div>
        <div v-for="p in preview" :key="p.uuid" class="min-w-0">
          <div class="flex items-baseline justify-between gap-2 text-xs">
            <span class="truncate text-slate-700" :title="p.name">{{ p.name }}</span>
            <span v-if="p.note" class="shrink-0 text-amber-700">{{ p.note }}</span>
          </div>
          <div class="relative mt-0.5 h-2.5 w-full overflow-hidden rounded-sm bg-slate-50" :style="{ maxWidth: `${STRIP_W}px` }">
            <span v-for="c in p.cells" :key="c.x" class="absolute inset-y-0"
                  :style="{ left: `${c.x}px`, width: `${c.w}px`, background: c.colour }"></span>
          </div>
        </div>
        <div v-if="devices.length > PREVIEW" class="text-xs text-slate-500">and {{ devices.length - PREVIEW }} more</div>
        <div v-if="stripNote" class="text-xs text-slate-500">{{ stripNote }}</div>
      </div>
      <div v-for="q in quiet" :key="q" class="text-xs text-amber-700">
        <i class="fa-solid fa-circle-exclamation mr-1"></i>{{ q }}
      </div>
      <div v-if="offline.length" class="text-xs text-amber-700">
        <i class="fa-solid fa-circle-exclamation mr-1"></i>
        Offline: {{ offline.slice(0, 5).map(d => d.name).join(', ') }}<template v-if="offline.length > 5">, and {{ offline.length - 5 }} more</template>.
      </div>
      <div v-if="hidden" class="text-xs text-slate-500">
        <i class="fa-solid fa-eye-slash mr-1"></i>
        {{ hidden }} {{ hidden === 1 ? 'dataset does' : 'datasets do' }} not show you {{ hidden === 1 ? 'its' : 'their' }} devices, so the counts may be low.
      </div>
    </div>

    <div class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-2">
      <button type="button" class="flex items-center gap-2 text-left font-semibold" :aria-expanded="showStore"
              @click="showStore = !showStore">
        <i :class="`fa-solid fa-chevron-${showStore ? 'down' : 'right'} text-[10px] text-slate-500`"></i>
        What the service will store
      </button>
      <template v-if="showStore">
        <div v-if="!rows.length" class="text-sm text-slate-500">Nothing yet.</div>
        <div v-for="(r, i) in rows" :key="i" class="border-t border-slate-100 py-1.5 text-sm">
          <div class="flex justify-between gap-2">
            <span>{{ r.text }}</span>
            <span class="whitespace-nowrap text-[11px] text-slate-500">{{ r.type }}</span>
          </div>
          <div v-if="r.note" class="text-xs text-slate-500 break-all" :class="{ 'font-mono': r.type === 'Session limits' }">{{ r.note }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useNow } from '@vueuse/core'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import {
  series_request, window_strip, device_status, fmt_since, count_too_long,
  LAST_LOOKBACK, LIMITS, NO_WINDOW_SPAN,
} from '@/lib/datasets/series.js'
import { window_gaps, gap_note } from '@/lib/datasets/gaps.js'
import { fmt_window } from '@/lib/datasets/model.js'
import { covered_devices } from './builder.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  rows: { type: Array, default: () => [] },
  // The window as { from, to } ISO strings, or null for none.
  window: { type: Object, default: null },
})

const PREVIEW = 8
const STRIP_W = 240
const DEBOUNCE_MS = 400

const ds = useDatasetsStore()
const showStore = ref(false)

const covered = computed(() => covered_devices(props.items, ds.byUuid))
const devices = computed(() => covered.value.devices.map(u => ds.deviceByUuid[u] ?? { uuid: u, name: u.slice(0, 8), metrics: [], status: null }))
const metrics = computed(() => devices.value.reduce((n, d) => n + (d.metrics?.length ?? 0), 0))
const online = computed(() => devices.value.filter(d => d.status?.online).length)
const offline = computed(() => devices.value.filter(d => d.status && !d.status.online))
const unknownStatus = computed(() => devices.value.filter(d => !d.status).length)
const hidden = computed(() => covered.value.unknown.length)

/* Data strips and "quiet since", fetched after the items or the window
 * stop changing. */
const sc = useServiceClientStore()
const nowDate = useNow({ interval: 30 * 1000 })
const counts = ref(null)
const lasts = ref({})
const stripNote = ref('')
let gen = 0
let timer = null

// The span the strips cover: the window, or the last 24 hours as of
// the last load.
function current_span () {
  const w = props.window
  if (w?.from && w?.to) return { from: Date.parse(w.from), to: Date.parse(w.to), own: true }
  const now = Date.now()
  return { from: now - NO_WINDOW_SPAN, to: now, own: false }
}
const span = ref(current_span())
const shown = computed(() => devices.value.slice(0, PREVIEW).map(d => d.uuid))
const caption = computed(() => span.value.own
  ? `Data across ${fmt_window(span.value.from, span.value.to)}`
  : 'Data in the last 24 hours')

const key = computed(() => props.window ? `${props.window.from}|${props.window.to}|${shown.value.join(',')}` : `-|${shown.value.join(',')}`)
const allKey = computed(() => devices.value.map(d => d.uuid).join(','))

watch([key, allKey], () => {
  clearTimeout(timer)
  timer = setTimeout(load, DEBOUNCE_MS)
}, { immediate: true })
onBeforeUnmount(() => { gen++; clearTimeout(timer) })

async function load () {
  const my = ++gen
  span.value = current_span()
  const { from, to } = span.value
  const now = Date.now()
  const list = shown.value
  counts.value = null
  stripNote.value = ''
  if (!list.length) return
  try {
    if (from >= now) stripNote.value = 'The window has not started, so there is no data yet.'
    else if (count_too_long(from, to)) stripNote.value = 'No data strips for windows over 14 days.'
    else {
      const s = await fetch_series(sc.client, series_request({ devices: list, from, to, points: 60, count: true }))
      if (my !== gen) return
      counts.value = s
    }
    const all = devices.value.map(d => d.uuid).slice(0, LIMITS.devices)
    const hour = Math.ceil(now / 3600e3) * 3600e3
    const l = await fetch_series(sc.client, series_request({ devices: all, from: hour - 3600e3, to: hour, every: '1h', last: LAST_LOOKBACK }))
    if (my !== gen) return
    const got = {}
    for (const u of all) if (!l.denied.includes(u)) got[u] = l.devices[u]?.last ?? null
    lasts.value = got
  }
  catch (err) {
    if (my !== gen) return
    console.warn('Datasets: preview data did not load', err)
    stripNote.value = 'The data strips did not load.'
  }
}

const gaps = computed(() => {
  const s = counts.value
  if (!s?.every) return null
  const by = {}
  for (const u of shown.value) if (!s.denied.includes(u)) by[u] = s.devices[u]?.count ?? []
  return window_gaps(by, { from: span.value.from, to: span.value.to, every: s.every, now: s.asOf })
})

const preview = computed(() => shown.value.map(u => {
  const d = ds.deviceByUuid[u]
  const s = counts.value
  const g = gaps.value?.devices[u]
  const strip = s ? window_strip(s.devices[u]?.count ?? [], { from: span.value.from, to: span.value.to, width: STRIP_W, cell: 4 }) : { cells: [] }
  let note = ''
  if (g?.grid.length) note = !g.points ? 'No data' : gap_note(g.gaps)
  return { uuid: u, name: d?.name ?? u.slice(0, 8), cells: strip.cells, note }
}))

// Online devices that have stopped sending. Offline ones are listed below.
const quiet = computed(() => {
  const now = nowDate.value.getTime()
  const out = []
  for (const d of devices.value) {
    if (!d.status?.online) continue
    const last = lasts.value[d.uuid]
    if (last === undefined) continue
    const st = device_status(d.status, last, now)
    if (st.state !== 'quiet') continue
    out.push(last === null ? `${d.name} has sent no data in the last 30 days` : `${d.name} quiet since ${fmt_since(last, now)}`)
  }
  return out.length > 5 ? [...out.slice(0, 5), `and ${out.length - 5} more quiet devices`] : out
})
</script>
