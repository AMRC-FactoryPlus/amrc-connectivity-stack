<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The builder's side rail: a preview of what the items cover, and a
     collapsed list of what the service will store. No data strips:
     there is no endpoint for data arrival yet. -->
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
import { ref, computed } from 'vue'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { covered_devices } from './builder.js'

const props = defineProps({
  items: { type: Array, default: () => [] },
  rows: { type: Array, default: () => [] },
})

const ds = useDatasetsStore()
const showStore = ref(false)

const covered = computed(() => covered_devices(props.items, ds.byUuid))
const devices = computed(() => covered.value.devices.map(u => ds.deviceByUuid[u] ?? { uuid: u, name: u.slice(0, 8), metrics: [], status: null }))
const metrics = computed(() => devices.value.reduce((n, d) => n + (d.metrics?.length ?? 0), 0))
const online = computed(() => devices.value.filter(d => d.status?.online).length)
const offline = computed(() => devices.value.filter(d => d.status && !d.status.online))
const unknownStatus = computed(() => devices.value.filter(d => !d.status).length)
const hidden = computed(() => covered.value.unknown.length)
</script>
