<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { defineAsyncComponent } from 'vue'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import QualityBadge from '@components/QualityBadge.vue'
import { useMonitorStore } from '@store/useMonitorStore.js'
import dayjs from 'dayjs'

import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([CanvasRenderer, LineChart, GridComponent])

const VChart = defineAsyncComponent(() =>
  import('vue-echarts').then(m => m.default ?? m)
)

const monitor = useMonitorStore()

function sparklineOption (trend) {
  if (!trend?.length || trend.length < 2) return null
  return {
    grid: { top: 0, right: 0, bottom: 0, left: 0 },
    xAxis: { show: false, type: 'value' },
    yAxis: { show: false, type: 'value' },
    series: [{
      type: 'line',
      data: trend.map((p, i) => [i, p.value]),
      smooth: true,
      symbol: 'none',
      lineStyle: { color: '#3b82f6', width: 1.5 },
      areaStyle: { color: 'rgba(59, 130, 246, 0.1)' },
    }],
  }
}

function formatValue (val) {
  if (val === null || val === undefined) return '-'
  if (typeof val === 'number') return val.toPrecision(6)
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}
</script>

<template>
  <Sheet :open="monitor.dialogOpen" @update:open="(v) => v ? monitor.openDialog() : monitor.closeDialog()">
    <SheetContent side="right" class="overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Monitored Items</SheetTitle>
        <SheetDescription>
          {{ monitor.items.size }} item{{ monitor.items.size === 1 ? '' : 's' }} monitored
          <span v-if="monitor.streaming" class="text-green-500 ml-1">
            <i class="fa-solid fa-circle text-[8px]"></i> Live
          </span>
        </SheetDescription>
      </SheetHeader>

      <div class="mt-4 space-y-3">
        <div v-if="!monitor.hasItems" class="text-sm text-slate-400 py-8 text-center">
          No items being monitored. Use the Subscribe button on a node to start.
        </div>

        <Card v-for="item in monitor.itemList" :key="item.elementId">
          <CardContent class="p-4">
            <div class="flex items-start justify-between mb-2">
              <div>
                <div class="font-medium text-sm">{{ item.displayName }}</div>
                <div class="flex items-center gap-2 mt-1">
                  <span class="font-mono text-lg">{{ formatValue(item.value) }}</span>
                  <QualityBadge :quality="item.quality" />
                </div>
                <div class="text-xs text-slate-400 mt-0.5">
                  {{ item.timestamp ? dayjs(item.timestamp).format('HH:mm:ss') : '-' }}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="text-slate-400 hover:text-red-500"
                @click="monitor.unsubscribe(item.elementId)"
                title="Unsubscribe"
              >
                <i class="fa-solid fa-xmark"></i>
              </Button>
            </div>

            <!-- Sparkline -->
            <div v-if="sparklineOption(item.trend)" class="mt-2">
              <Suspense>
                <VChart :option="sparklineOption(item.trend)" autoresize style="height: 40px" />
                <template #fallback><div style="height: 40px"></div></template>
              </Suspense>
            </div>
          </CardContent>
        </Card>
      </div>

      <div v-if="monitor.hasItems" class="mt-4 border-t pt-4">
        <Button variant="outline" size="sm" class="w-full" @click="monitor.unsubscribeAll">
          Unsubscribe All
        </Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
