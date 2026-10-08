<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One metric across runs, each line aligned to its run's start.
     `lines` is [{ name, style, pairs }], where pairs are
     [ms since start, value] and style comes from line_style(). -->
<template>
  <VChart class="h-80 w-full" :option="option" autoresize/>
</template>

<script setup>
import { computed, defineAsyncComponent } from 'vue'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { fmt_hmm } from '@/lib/datasets/compare.js'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, DataZoomComponent])

const VChart = defineAsyncComponent(() =>
  import('vue-echarts').then(m => m.default ?? m)
)

const props = defineProps({
  lines: { type: Array, required: true },
  unit: { type: String, default: '' },
})

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const num = v => typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toFixed(0) : +v.toPrecision(4)) : v

const option = computed(() => ({
  animation: false,
  grid: { left: 56, right: 24, top: 28, bottom: 40 },
  xAxis: {
    type: 'value',
    min: 0,
    name: 'Time since start',
    nameLocation: 'middle',
    nameGap: 26,
    nameTextStyle: { color: '#64748b', fontSize: 12 },
    axisLabel: { formatter: v => fmt_hmm(v), color: '#64748b' },
    axisLine: { lineStyle: { color: '#e2e8f0' } },
    splitLine: { show: false },
  },
  yAxis: {
    type: 'value',
    scale: true,
    name: props.unit || '',
    nameTextStyle: { color: '#64748b', fontSize: 12 },
    axisLabel: { color: '#64748b' },
    splitLine: { lineStyle: { color: '#f1f5f9' } },
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'line' },
    formatter: params => {
      if (!params?.length) return ''
      const head = fmt_hmm(params[0].value[0])
      const body = params.map(p => `${p.marker}${esc(p.seriesName)}: ${esc(num(p.value[1]))}${props.unit ? ` ${esc(props.unit)}` : ''}`)
      return [head, ...body].join('<br>')
    },
  },
  dataZoom: [{ type: 'inside', xAxisIndex: 0 }],
  series: props.lines.map(l => ({
    type: 'line',
    name: l.name,
    data: l.pairs,
    showSymbol: false,
    lineStyle: { color: l.style.color, type: l.style.type, width: 1.5, opacity: l.style.opacity },
    itemStyle: { color: l.style.color, opacity: l.style.opacity },
    emphasis: { disabled: true },
  })),
}))
</script>
