<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Choose equipment: a search box and a tile per piece of equipment
     with its state (recording, ready, devices offline). -->
<template>
  <div class="flex flex-1 flex-col gap-4 overflow-auto p-6">
    <div class="flex flex-wrap items-center gap-4">
      <div class="relative w-full max-w-[420px]">
        <i class="fa-solid fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
        <input v-model="search" type="search" placeholder="Search equipment" aria-label="Search equipment"
               class="h-[52px] w-full rounded-md border border-slate-200 bg-white pl-11 pr-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"/>
      </div>
      <span class="text-sm text-gray-500"><i class="fa-solid fa-qrcode mr-1"></i>Or scan the QR code on the equipment</span>
    </div>

    <div v-if="!ds.ready" class="flex items-center gap-3 py-12 text-slate-500">
      <i class="fa-solid fa-circle-notch animate-spin"></i> Loading equipment
    </div>
    <div v-else-if="!tiles.length" class="py-12 text-slate-500">
      {{ search ? 'No equipment matches.' : 'There is no equipment yet. An engineer creates equipment in Datasets.' }}
    </div>
    <div v-else class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));">
      <button v-for="t in tiles" :key="t.uuid" type="button"
              class="flex min-h-[140px] flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
              @click="emit('choose', t.uuid)">
        <div class="flex w-full items-start justify-between gap-2">
          <span class="min-w-0 truncate text-xl font-semibold tracking-tight" :title="t.name">{{ t.name }}</span>
          <span class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium tabular-nums" :class="t.color">
            <span class="h-2.5 w-2.5 rounded-full" :class="t.dot"></span>{{ t.state }}
          </span>
        </div>
        <div class="text-sm text-gray-500">{{ t.where }}</div>
        <div class="mt-auto text-sm text-gray-700">{{ t.sub }}</div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { display_name, fmt_elapsed, fmt_time } from '@/lib/datasets/model.js'
import { device_summary, main_area } from '@/lib/datasets/kiosk.js'

const props = defineProps({
  now: { type: Number, required: true },
})
const emit = defineEmits(['choose'])

const ds = useDatasetsStore()
const search = ref('')

const tiles = computed(() => {
  const q = search.value.trim().toLowerCase()
  return ds.equipment
    .map(e => tile(e))
    .filter(t => !q || t.name.toLowerCase().includes(q) || (t.area ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
})

function tile (e) {
  const devs = ds.devicesOf(e.uuid).devices.map(u => ds.deviceByUuid[u]).filter(Boolean)
  const sum = device_summary(devs, ds.statusReady)
  const area = main_area(devs)
  const rec = ds.recordings[e.uuid]
  const last = (ds.runsByEquipment[e.uuid] ?? []).find(r => !r.voided)
  const n = sum.total
  let state, color, dot
  if (rec?.stoppedAt) { state = 'Not saved'; color = 'text-red-600'; dot = 'bg-red-500' }
  else if (rec) { state = `Recording ${fmt_elapsed(props.now - Date.parse(rec.startedAt))}`; color = 'text-green-600'; dot = 'bg-green-500' }
  else if (sum.none_online) { state = 'Devices offline'; color = 'text-amber-700'; dot = 'bg-amber-500' }
  else { state = 'Ready'; color = 'text-slate-500'; dot = 'bg-slate-400' }
  return {
    uuid: e.uuid,
    name: display_name(e),
    area,
    where: [area, `${n} ${n === 1 ? 'device' : 'devices'}`].filter(Boolean).join(' · '),
    state, color, dot,
    sub: rec
      ? `Started ${fmt_time(Date.parse(rec.startedAt), props.now)}${rec.operator ? ` by ${rec.operator}` : ''}`
      : last ? `Last recording ${fmt_time(Date.parse(last.from), props.now)}` : 'No recordings yet',
  }
}
</script>
