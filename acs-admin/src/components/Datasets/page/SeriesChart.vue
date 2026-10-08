<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One metric as a thin line with no axes or grid, from `from` to
     `to`, so rows stacked under one shared axis line up. Draws
     display_rows(): bucket means and raw live values, as steps for a
     metric sent on change. A null breaks the line. Hover shows the value. -->
<template>
  <VChart class="h-full w-full" :option="option" autoresize/>
</template>

<script setup>
import { computed, defineAsyncComponent } from 'vue'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { fmt_time } from '@/lib/datasets/model.js'
import { y_range, gap_joins } from '@/lib/datasets/series.js'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent])

const VChart = defineAsyncComponent(() =>
  import('vue-echarts').then(m => m.default ?? m)
)

const props = defineProps({
  // display_rows(): [[ms, value|null]]
  rows: { type: Array, required: true },
  // Hold each value until the next (a metric sent on change).
  step: { type: Boolean, default: false },
  from: { type: Number, required: true },
  to: { type: Number, required: true },
  unit: { type: String, default: '' },
})

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const num = v => typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toFixed(0) : +v.toPrecision(4)) : v

const option = computed(() => ({
  animation: false,
  grid: { left: 0, right: 0, top: 6, bottom: 6 },
  xAxis: { type: 'time', min: props.from, max: props.to, show: false },
  // Fitted to the points in view, not to everything cached.
  yAxis: { type: 'value', scale: true, show: false, ...(y_range(props.rows, props.from, props.to) ?? {}) },
  tooltip: {
    trigger: 'axis',
    // Keep the tooltip inside the chart, so the card does not clip it.
    confine: true,
    axisPointer: { type: 'line', lineStyle: { color: '#94a3b8' } },
    formatter: params => {
      const p = params?.find(x => x.seriesIndex === 0 && x.value?.[1] != null)
      if (!p) return ''
      return `${esc(fmt_time(p.value[0]))}<br>${esc(num(p.value[1]))}${props.unit ? ` ${esc(props.unit)}` : ''}`
    },
  },
  series: [{
    type: 'line',
    data: props.rows,
    step: props.step ? 'end' : false,
    showSymbol: props.rows.length < 3,
    symbolSize: 3,
    connectNulls: false,
    lineStyle: { color: '#0f172a', width: 1.25 },
    itemStyle: { color: '#0f172a' },
    emphasis: { disabled: true },
  }, {
    // Gaps, joined faintly so the line reads on.
    type: 'line',
    data: gap_joins(props.rows),
    step: props.step ? 'end' : false,
    showSymbol: false,
    connectNulls: false,
    silent: true,
    lineStyle: { color: '#0f172a', width: 1.25, opacity: 0.35, type: 'dashed' },
    emphasis: { disabled: true },
    tooltip: { show: false },
  }],
}))
</script>
