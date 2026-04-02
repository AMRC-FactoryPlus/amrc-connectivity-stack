<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import QualityBadge from '@components/QualityBadge.vue'
import { useI3xClient } from '@composables/useI3xClient.js'
import dayjs from 'dayjs'

import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DataZoomComponent])

const VChart = defineAsyncComponent(() =>
  import('vue-echarts').then(m => m.default ?? m)
)

const props = defineProps({
  elementId: { type: String, required: true },
  isComposition: { type: Boolean, default: false },
})

const i3x = useI3xClient()
const loading = ref(false)
const error = ref(null)
const historyData = ref(null)
const selectedPreset = ref('1h')

const presets = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
]

const customStart = ref('')
const customEnd = ref('')
const showCustom = ref(false)

function selectPreset (preset) {
  selectedPreset.value = preset.label
  showCustom.value = false
}

function selectCustom () {
  selectedPreset.value = 'custom'
  showCustom.value = true
}

function getTimeRange () {
  if (selectedPreset.value === 'custom') {
    return {
      startTime: new Date(customStart.value).toISOString(),
      endTime: new Date(customEnd.value).toISOString(),
    }
  }
  const preset = presets.find(p => p.label === selectedPreset.value)
  const end = new Date()
  const start = new Date(end.getTime() - preset.hours * 60 * 60 * 1000)
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  }
}

async function loadHistory () {
  loading.value = true
  error.value = null
  historyData.value = null
  try {
    const { startTime, endTime } = getTimeRange()
    const result = await i3x.getHistory(props.elementId, startTime, endTime)
    historyData.value = result
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.elementId, () => {
  historyData.value = null
  error.value = null
})

const isNumeric = computed(() => {
  if (!historyData.value?.values?.length) return false
  return historyData.value.values.some(v => typeof v.value === 'number')
})

const chartOption = computed(() => {
  if (!historyData.value?.values?.length || !isNumeric.value) return null

  const values = historyData.value.values

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter (params) {
        const p = params[0]
        if (!p) return ''
        return `${dayjs(p.axisValue).format('YYYY-MM-DD HH:mm:ss')}<br/>Value: <b>${p.value ?? '-'}</b>`
      },
    },
    grid: {
      left: 60,
      right: 20,
      top: 20,
      bottom: 60,
    },
    xAxis: {
      type: 'time',
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (val) => Number(val).toPrecision(4),
      },
    },
    dataZoom: [
      { type: 'slider', xAxisIndex: 0, start: 0, end: 100, height: 20 },
      { type: 'inside', xAxisIndex: 0 },
    ],
    series: [
      {
        type: 'line',
        data: values.map(v => [v.timestamp, typeof v.value === 'number' ? v.value : null]),
        smooth: false,
        symbol: 'none',
        lineStyle: { color: '#3b82f6', width: 2 },
        areaStyle: { color: 'rgba(59, 130, 246, 0.08)' },
        connectNulls: false,
      },
    ],
  }
})

function exportCSV () {
  if (!historyData.value?.values?.length) return

  const rows = [['timestamp', 'value', 'quality']]
  for (const v of historyData.value.values) {
    rows.push([v.timestamp, String(v.value ?? ''), v.quality ?? ''])
  }
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.elementId}-history.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <Card>
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base">History</CardTitle>
        <Button
          v-if="historyData?.values?.length"
          variant="ghost"
          size="sm"
          @click="exportCSV"
          title="Export CSV"
        >
          <i class="fa-solid fa-download mr-1"></i>
          CSV
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      <div v-if="isComposition" class="text-sm text-slate-500">
        <i class="fa-solid fa-info-circle mr-1"></i>
        Select a leaf metric to view history. Compositions do not have direct historical data.
      </div>

      <div v-else>
        <div class="flex items-center gap-2 mb-3 flex-wrap">
          <Button
            v-for="preset in presets"
            :key="preset.label"
            :variant="selectedPreset === preset.label ? 'default' : 'outline'"
            size="sm"
            @click="selectPreset(preset)"
          >
            {{ preset.label }}
          </Button>
          <Button
            :variant="selectedPreset === 'custom' ? 'default' : 'outline'"
            size="sm"
            @click="selectCustom"
          >
            Custom
          </Button>
          <Button
            size="sm"
            class="ml-auto"
            @click="loadHistory"
            :disabled="loading || (showCustom && (!customStart || !customEnd))"
          >
            <i class="fa-solid fa-clock-rotate-left mr-1"></i>
            Load History
          </Button>
        </div>

        <div v-if="showCustom" class="flex items-center gap-2 mb-3">
          <input
            v-model="customStart"
            type="datetime-local"
            class="px-2 py-1 text-sm border border-border rounded-md"
          />
          <span class="text-sm text-slate-400">to</span>
          <input
            v-model="customEnd"
            type="datetime-local"
            class="px-2 py-1 text-sm border border-border rounded-md"
          />
        </div>

        <div v-if="loading" class="flex items-center justify-center py-8 text-slate-400">
          <i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading history...
        </div>

        <div v-else-if="error" class="text-sm text-red-500 py-4">{{ error }}</div>

        <div v-else-if="historyData && isNumeric">
          <Suspense>
            <VChart :option="chartOption" autoresize style="height: 300px" />
            <template #fallback>
              <div class="flex items-center justify-center py-8 text-slate-400">Loading chart...</div>
            </template>
          </Suspense>
        </div>

        <div v-else-if="historyData && historyData.values?.length" class="border rounded-md overflow-hidden max-h-[300px] overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 sticky top-0">
              <tr>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Timestamp</th>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Value</th>
                <th class="text-left px-3 py-1.5 font-medium text-slate-600">Quality</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(v, i) in historyData.values" :key="i" class="border-t">
                <td class="px-3 py-1.5 text-xs text-slate-500">{{ dayjs(v.timestamp).format('YYYY-MM-DD HH:mm:ss') }}</td>
                <td class="px-3 py-1.5 font-mono">{{ v.value ?? '-' }}</td>
                <td class="px-3 py-1.5"><QualityBadge :quality="v.quality" /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else-if="historyData && !historyData.values?.length" class="text-sm text-slate-400 py-4">
          No historical data for this time range.
        </div>
      </div>
    </CardContent>
  </Card>
</template>
