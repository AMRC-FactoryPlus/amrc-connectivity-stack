<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Data tab: the metrics each device records, with a search. No
     charts yet; they need a data endpoint. -->
<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <span><i class="fa-solid fa-chart-line mr-2 text-slate-400"></i>Download the CSV to see the values.</span>
      <Button size="sm" variant="outline" :disabled="downloading" @click="$emit('download')">
        <i :class="['fa-solid mr-2', downloading ? 'fa-circle-notch animate-spin' : 'fa-download']"></i>Download CSV
      </Button>
    </div>

    <div v-if="!record.structure" class="py-8 text-center text-sm text-slate-500">
      Structure is visible to people who can edit this dataset, so the metric list is not available.
    </div>
    <template v-else>
      <div class="relative max-w-md">
        <Input v-model="query" icon="magnifying-glass" :placeholder="`Search ${total} metrics...`"/>
      </div>

      <div v-if="!devices.length" class="py-8 text-center text-sm text-slate-500">
        {{ resolved.devices.length ? 'The device details are still loading.' : 'This dataset covers no devices.' }}
      </div>
      <div v-else-if="!groups.length" class="py-8 text-center text-sm text-slate-500">No metric matches "{{ query }}".</div>

      <Card v-for="g in groups" :key="g.device.uuid" class="overflow-hidden">
        <div class="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm">
          <span class="font-semibold"><i class="fa-solid fa-microchip mr-2 text-xs text-slate-500"></i>{{ g.device.name }}</span>
          <span class="text-xs text-slate-500">{{ g.metrics.length }}{{ query ? ` of ${g.device.metrics.length}` : '' }} {{ g.device.metrics.length === 1 ? 'metric' : 'metrics' }}</span>
        </div>
        <div v-if="!g.metrics.length" class="px-4 py-3 text-sm text-slate-500">This device records no metrics to the historian.</div>
        <div v-else class="max-h-96 overflow-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-white text-left text-xs text-slate-500">
              <tr><th class="px-4 py-1.5 font-medium">Metric</th><th class="px-4 py-1.5 font-medium">Type</th><th class="px-4 py-1.5 font-medium">Unit</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in g.metrics" :key="m.path" class="border-t border-slate-100">
                <td class="px-4 py-1.5">
                  <div class="font-medium">{{ m.name }}</div>
                  <div v-if="m.path !== m.name" class="font-mono text-xs text-slate-500">{{ m.path }}</div>
                </td>
                <td class="px-4 py-1.5 text-slate-600">{{ m.type }}</td>
                <td class="px-4 py-1.5 text-slate-600">{{ m.unit ?? '–' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div v-if="missing" class="text-xs text-slate-500">
        <i class="fa-solid fa-circle-info mr-1"></i>{{ missing }} {{ missing === 1 ? 'device is' : 'devices are' }} not in the device list, so {{ missing === 1 ? 'its' : 'their' }} metrics are not shown.
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { metric_total, filter_metrics } from './page-logic.js'

const props = defineProps({
  record: { type: Object, required: true },
  resolved: { type: Object, required: true },
  downloading: { type: Boolean, default: false },
})
defineEmits(['download'])

const ds = useDatasetsStore()
const query = ref('')

const devices = computed(() => props.resolved.devices.map(d => ds.deviceByUuid[d]).filter(Boolean))
const missing = computed(() => ds.devicesReady ? props.resolved.devices.length - devices.value.length : 0)
const total = computed(() => metric_total(devices.value))
const groups = computed(() => filter_metrics(devices.value, query.value))
</script>
