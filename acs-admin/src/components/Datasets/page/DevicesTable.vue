<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The devices a dataset covers: name with an online dot, site and
     area, the equipment label and the number of historised metrics. -->
<template>
  <Card class="overflow-hidden">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <span class="font-semibold">Devices <span class="font-normal text-slate-500">{{ rows.length }}</span></span>
    </div>
    <div v-if="!record.structure" class="px-4 py-6 text-center text-sm text-slate-500">
      Structure is visible to people who can edit this dataset.
    </div>
    <div v-else-if="!rows.length" class="px-4 py-6 text-center text-sm text-slate-500">
      This dataset covers no devices.
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th class="px-4 py-2 font-medium">Device</th>
            <th class="px-4 py-2 font-medium">Label</th>
            <th class="px-4 py-2 text-right font-medium">Metrics</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.dd" class="border-t border-slate-100">
            <td class="max-w-72 px-4 py-2.5">
              <div class="flex items-center gap-2 font-medium" :title="row.name">
                <i class="fa-solid fa-microchip fa-fw text-xs text-slate-500"></i>
                <span class="truncate">{{ row.name }}</span>
                <span :class="['size-1.5 shrink-0 rounded-full', row.dot]" :title="row.statusText"></span>
              </div>
              <div v-if="row.where" class="pl-6 text-xs text-slate-500">{{ row.where }}</div>
            </td>
            <td class="px-4 py-2.5">
              <span v-if="row.label" class="rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium">{{ row.label }}</span>
            </td>
            <td class="px-4 py-2.5 text-right tabular-nums text-slate-700">{{ row.metrics ?? '–' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="record.structure && unknown.length" class="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
      <i class="fa-solid fa-eye-slash mr-1"></i>
      {{ unknown.length }} {{ unknown.length === 1 ? 'part of this dataset is' : 'parts of this dataset are' }} not visible to you, so the list may be incomplete.
    </div>
  </Card>
</template>

<script setup>
import { computed } from 'vue'
import { Card } from '@/components/ui/card'
import { useDatasetsStore } from '@store/useDatasetsStore.js'

const props = defineProps({
  record: { type: Object, required: true },
  resolved: { type: Object, required: true },
  labels: { type: Object, default: () => ({}) },
})

const ds = useDatasetsStore()
const unknown = computed(() => props.resolved.unknown.filter(u => u !== props.record.uuid || props.record.structure))

const rows = computed(() => props.resolved.device_datasets.map(dd => {
  const dev_uuid = ds.byUuid[dd]?.config?.source
  const dev = ds.deviceByUuid[dev_uuid]
  const online = dev?.status?.online
  return {
    dd,
    name: dev?.name ?? ds.name(dd),
    where: [dev?.site, dev?.area].filter(Boolean).join(' · '),
    label: props.labels[dd] ?? null,
    metrics: dev?.metrics?.length ?? null,
    dot: online == null ? 'bg-slate-300' : online ? 'bg-green-500' : 'bg-slate-400',
    statusText: online == null ? 'Status not known' : online ? 'Online' : 'Offline',
  }
}))
</script>
