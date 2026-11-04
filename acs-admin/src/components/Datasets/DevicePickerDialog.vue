<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Pick devices for the builder. The list comes from i3X, which shows
     each person only the devices they may read, grouped under their
     ISA-95 path. About 450 devices is normal, so only the first page of
     matches renders; "Show more" adds the next page. Devices already in
     the builder are greyed out. Emits `add` with the chosen device
     UUIDs. -->
<template>
  <Dialog :open="open" @update:open="v => emit('update:open', v)">
    <DialogContent class="sm:max-w-[720px] flex flex-col gap-3 h-[75vh] overflow-hidden">
      <DialogHeader>
        <DialogTitle>Add devices</DialogTitle>
        <DialogDescription>Choose the devices to include. Status comes from the Directory and the historian.</DialogDescription>
      </DialogHeader>

      <div class="relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"></i>
        <input v-model="search" type="search" placeholder="Search by name, ISA-95 level or Sparkplug address"
               class="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-950"/>
      </div>

      <div v-if="chips" class="flex flex-wrap gap-1.5">
        <button v-for="c in ['all', ...chips.values]" :key="c" type="button"
                class="h-7 rounded-full border px-3 text-xs transition-colors"
                :class="chip === c ? 'border-slate-900 bg-slate-900 text-slate-50' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'"
                @click="chip = c">
          {{ c === 'all' ? 'All' : c }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
        <div v-if="!ds.i3xReady && !ds.i3xDevices.length" class="p-6 text-center text-sm text-slate-500">
          <i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading devices
        </div>
        <div v-else-if="ds.i3xError && !ds.i3xDevices.length" class="flex flex-col items-center gap-3 p-6 text-center text-sm text-slate-500">
          {{ ds.i3xError }}
          <Button variant="outline" size="xs" @click="ds.loadI3xDevices()">Try again</Button>
        </div>
        <div v-else-if="!ds.i3xDevices.length" class="p-6 text-center text-sm text-slate-500">
          You can't see any devices in i3X. Ask an administrator for access.
        </div>
        <div v-else-if="!matched.length" class="p-6 text-center text-sm text-slate-500">No devices match.</div>
        <template v-for="g in groups" :key="g.key">
          <div class="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
            <i class="fa-solid fa-sitemap text-slate-500"></i>{{ g.label }}
          </div>
          <label v-for="d in g.devices" :key="d.uuid"
                 class="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm"
                 :class="have.has(d.uuid) ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-slate-50'">
            <input type="checkbox" class="h-4 w-4 accent-slate-900"
                   :checked="have.has(d.uuid) || chosen.has(d.uuid)" :disabled="have.has(d.uuid)"
                   @change="toggle(d.uuid)"/>
            <i class="fa-solid fa-fw fa-microchip text-xs text-slate-500"></i>
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium" :title="d.name">{{ d.name }}</div>
              <div class="truncate text-xs text-slate-500">
                {{ subOf(d) }}
              </div>
            </div>
            <span v-if="have.has(d.uuid)" class="text-xs text-slate-500">Added</span>
            <span v-else class="flex shrink-0 items-center gap-1.5 text-xs" :class="statusOf(d).text">
              <span class="h-1.5 w-1.5 rounded-full" :class="statusOf(d).dot"></span>{{ statusOf(d).label }}
            </span>
          </label>
        </template>
        <div v-if="matched.length > limit" class="p-3 text-center">
          <Button variant="outline" size="xs" @click="limit += PAGE">
            Show more ({{ matched.length - limit }} more)
          </Button>
        </div>
      </div>

      <DialogFooter class="items-center sm:justify-between">
        <span class="text-sm text-slate-500">{{ chosen.size }} selected</span>
        <div class="flex gap-2">
          <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button :disabled="!chosen.size" @click="confirm">
            Add {{ chosen.size }} {{ chosen.size === 1 ? 'device' : 'devices' }}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { fetch_series } from '@/lib/datasets/api.js'
import { device_status, series_request, LAST_LOOKBACK, LIMITS, DEVICE_STORE } from '@/lib/datasets/series.js'
import { device_gaps, data_rate, fmt_rate } from '@/lib/datasets/gaps.js'
import { text_match, equipment_by_device } from './builder/builder.js'
import { group_by_path, path_chips } from '@/lib/datasets/i3x-devices.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  // Device UUIDs already in the builder.
  added: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'add'])

const PAGE = 150
const ds = useDatasetsStore()
const search = ref('')
const chip = ref('all')
const chosen = ref(new Set())
const limit = ref(PAGE)

// Start fresh each time the dialog opens, and ask i3X again so a new
// grant shows up.
watch(() => props.open, v => {
  if (!v) return
  search.value = ''
  chip.value = 'all'
  chosen.value = new Set()
  limit.value = PAGE
  ds.loadI3xDevices()
})
watch([search, chip], () => { limit.value = PAGE })

const have = computed(() => new Set(props.added))

// The devices i3X shows, with ConfigDB details where they are readable.
const devices = computed(() => {
  const index = ds.deviceIndexByUuid
  return ds.i3xDevices.map(d => index[d.uuid] ?? d)
})

const chips = computed(() => path_chips(devices.value))

const inEquipment = computed(() => props.open ? equipment_by_device(ds.equipment, ds.byUuid, u => ds.name(u)) : {})

const matched = computed(() => devices.value.filter(d =>
  (chip.value === 'all' || !chips.value || d.path?.[chips.value.depth] === chip.value)
  && text_match(search.value, [d.name, d.sparkplug, d.address, ...(d.path ?? [])])))

// Group the whole match so paths sort properly, then render only the
// first `limit` devices.
const groups = computed(() => {
  let left = limit.value
  const out = []
  for (const g of group_by_path(matched.value)) {
    if (left <= 0) break
    const devices = g.devices.slice(0, left)
    left -= devices.length
    out.push({ ...g, devices })
  }
  return out
})

// What a row says under the name. The metric count needs the ConfigDB,
// which not everyone can read.
function subOf (d) {
  const parts = []
  if (Array.isArray(d.metrics)) parts.push(`${d.metrics.length} ${d.metrics.length === 1 ? 'metric' : 'metrics'}`)
  if (rates.value[d.uuid]) parts.push(rates.value[d.uuid])
  if (inEquipment.value[d.uuid]) parts.push(`In ${inEquipment.value[d.uuid].join(', ')}`)
  return parts.join(' · ') || 'Device'
}

/* "Quiet since" and the data rate over the last hour for the devices
 * on screen, fetched once per dialog for each device as it is shown.
 * A device whose request failed is asked again on the next change or
 * after a short wait. Answers from an earlier opening are dropped. */
const RATE_EVERY = '5m'
const RATE_STEP = 5 * 60e3
const RETRY_MS = 15 * 1000
const sc = useServiceClientStore()
const lasts = ref({})
const rates = ref({})
let asked = new Set()
let lastTimer = null
let retryTimer = null
let openGen = 0

watch(() => props.open, v => {
  openGen++
  clearTimeout(retryTimer)
  if (v) { asked = new Set(); lasts.value = {}; rates.value = {} }
})
onBeforeUnmount(() => {
  openGen++
  clearTimeout(lastTimer)
  clearTimeout(retryTimer)
})

const shownUuids = computed(() => groups.value.flatMap(g => g.devices.map(d => d.uuid)))

watch([shownUuids, () => props.open], () => {
  clearTimeout(lastTimer)
  if (!props.open) return
  lastTimer = setTimeout(loadLasts, 300)
})

async function loadLasts () {
  const want = shownUuids.value.filter(u => !asked.has(u)).slice(0, LIMITS.devices)
  if (!want.length || !props.open) return
  const my = openGen
  for (const u of want) asked.add(u)
  // The last hour of closed buckets, so no bucket is mostly empty.
  const to = Math.floor(Date.now() / RATE_STEP) * RATE_STEP
  const from = to - 3600e3
  try {
    // New device datasets read the UNS, so the rate is the UNS's.
    const s = await fetch_series(sc.client, series_request({ devices: want, from, to, every: RATE_EVERY, count: true, last: LAST_LOOKBACK, store: DEVICE_STORE }))
    if (my !== openGen) return
    const got = {}, rate = {}
    for (const u of want) {
      if (s.denied.includes(u)) continue
      got[u] = s.devices[u]?.last ?? null
      const g = device_gaps(s.devices[u]?.count ?? [], { from, to, every: RATE_EVERY, now: s.asOf })
      rate[u] = fmt_rate(data_rate(g, RATE_EVERY))
    }
    lasts.value = { ...lasts.value, ...got }
    rates.value = { ...rates.value, ...rate }
  }
  catch (err) {
    if (my !== openGen) return
    // Status still shows online or offline from the Directory. Ask again.
    console.warn('Datasets: quiet since did not load', err)
    for (const u of want) asked.delete(u)
    clearTimeout(retryTimer)
    retryTimer = setTimeout(loadLasts, RETRY_MS)
  }
}

function statusOf (d) {
  return device_status(d.status, lasts.value[d.uuid])
}

function toggle (uuid) {
  if (have.value.has(uuid)) return
  const next = new Set(chosen.value)
  next.has(uuid) ? next.delete(uuid) : next.add(uuid)
  chosen.value = next
}

function confirm () {
  emit('add', [...chosen.value])
  emit('update:open', false)
}
</script>
