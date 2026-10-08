<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The energy and carbon add-on card. It works the figures out in the
     browser from the dataset's CSV and saves nothing. `ec` is the
     state from useEnergyCarbon, owned by the page. -->
<template>
  <Card class="flex flex-col">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2 font-semibold text-gray-900">
          <i class="fa-solid fa-bolt text-slate-500"></i>Energy and carbon
        </div>
        <p class="mt-1 text-sm text-slate-500">
          Energy from the dataset's energy registers or active power, and the carbon that energy stands for.
        </p>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-slate-500"><i class="fa-solid fa-laptop mr-1"></i>Calculated in your browser, not saved.</span>
        <Button v-if="canCalculate && ec.state.value !== 'idle'" size="sm" variant="outline"
                :disabled="ec.state.value === 'loading'" @click="ec.calculate()">
          <i class="fa-solid fa-rotate mr-2"></i>Calculate again
        </Button>
      </div>
    </div>

    <!-- Not applicable before reading any data. -->
    <div v-if="!canCalculate" class="flex items-start gap-3 px-5 py-6 text-sm text-slate-700">
      <i class="fa-solid fa-circle-info mt-0.5 text-slate-400"></i>
      <div>
        <div class="font-medium text-gray-900">This add-on does not apply to this dataset.</div>
        <div class="mt-1 text-slate-600">{{ ec.applies.value.reason }}</div>
      </div>
    </div>

    <!-- Not calculated yet. -->
    <div v-else-if="ec.state.value === 'idle'" class="flex flex-wrap items-center justify-between gap-4 px-5 py-6">
      <div class="text-sm text-slate-700 max-w-prose">
        <div class="font-medium text-gray-900">Not calculated yet</div>
        <div class="mt-1 text-slate-600">
          Calculate downloads the whole dataset ({{ windowText }}) into this page and works out the figures.
          Large datasets can take a while.
        </div>
        <div v-if="ec.applies.value.state === 'unknown'" class="mt-1 text-slate-500">
          The device details are not available, so the energy registers and power are found from the data.
        </div>
        <div v-if="filling" class="mt-1 text-amber-700">
          <i class="fa-solid fa-hourglass-half mr-1"></i>The window has not ended. The figures cover the data so far.
        </div>
      </div>
      <Button @click="ec.calculate()"><i class="fa-solid fa-calculator mr-2"></i>Calculate</Button>
    </div>

    <div v-else-if="ec.state.value === 'loading'" class="flex items-center gap-3 px-5 py-8 text-sm text-slate-700">
      <i class="fa-solid fa-circle-notch animate-spin text-slate-400"></i>
      Downloading the dataset and reading the energy registers and power.
    </div>

    <div v-else-if="ec.state.value === 'error'" class="flex flex-wrap items-start justify-between gap-4 px-5 py-6">
      <div class="flex items-start gap-3 text-sm">
        <i class="fa-solid fa-triangle-exclamation mt-0.5 text-red-500"></i>
        <div>
          <div class="font-medium text-gray-900">The calculation did not finish.</div>
          <div class="mt-1 text-slate-600">{{ ec.error.value }}</div>
        </div>
      </div>
      <Button variant="outline" @click="ec.calculate()"><i class="fa-solid fa-rotate mr-2"></i>Try again</Button>
    </div>

    <div v-else-if="ec.state.value === 'empty'" class="flex items-start gap-3 px-5 py-6 text-sm">
      <i class="fa-solid fa-circle-info mt-0.5 text-slate-400"></i>
      <div>
        <div class="font-medium text-gray-900">No energy register found in the data.</div>
        <div class="mt-1 text-slate-600">
          The add-on needs an energy register (Wh, kWh or MWh) or active power (W, kW or MW).
          None of the data in this window has one.
        </div>
      </div>
    </div>

    <!-- Ready. -->
    <div v-else class="flex flex-col gap-4 px-5 py-4">
      <div v-if="!r" class="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Tick at least one meter below to see figures.
      </div>
      <div v-else class="grid grid-cols-1 overflow-hidden rounded-lg border border-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        <div class="border-b border-slate-200 px-4 py-3 sm:border-r xl:border-b-0">
          <div class="text-xs text-slate-500">Energy</div>
          <div class="text-xl font-semibold tabular-nums tracking-tight">{{ kwh(r.kwh) }} kWh</div>
          <div class="text-xs text-slate-500">Includes baseload. There is no baseline.</div>
        </div>
        <div class="border-b border-slate-200 px-4 py-3 xl:border-b-0 xl:border-r">
          <div class="text-xs text-slate-500">Carbon, fixed factor</div>
          <div class="text-xl font-semibold tabular-nums tracking-tight">{{ kg(r.kg_fixed) }} kgCO2e</div>
          <div class="text-xs text-slate-500">{{ CARBON.FIXED_FACTOR }} kg per kWh</div>
        </div>
        <div class="border-b border-slate-200 px-4 py-3 sm:border-b-0 sm:border-r">
          <div class="text-xs text-slate-500">Carbon, grid intensity</div>
          <template v-if="r.kg_grid != null">
            <div class="text-xl font-semibold tabular-nums tracking-tight">{{ kg(r.kg_grid) }} kgCO2e</div>
            <div class="text-xs text-slate-500">
              Half-hourly intensity.
              <span v-if="r.kwh_no_intensity > 0" class="text-amber-700">{{ kwh(r.kwh_no_intensity) }} kWh has no intensity and is left out.</span>
            </div>
          </template>
          <template v-else>
            <div class="text-xl font-semibold text-slate-400">Not available</div>
            <div class="text-xs text-slate-500">Needs the grid intensity feed in this dataset.</div>
          </template>
        </div>
        <div class="px-4 py-3">
          <div class="text-xs text-slate-500">Confidence</div>
          <div class="flex items-center gap-2 text-xl font-semibold capitalize tracking-tight">
            <span :class="['size-2.5 rounded-full', confidenceDot]"></span>{{ r.confidence }}
          </div>
          <div class="text-xs text-slate-500">
            {{ pct(r.coverage) }} of the window has readings.
            <template v-if="r.estimated_kwh > 0">{{ kwh(r.estimated_kwh) }} kWh at the window edges is estimated from the nearest readings.</template>
            {{ r.bad_segments ? `${r.bad_segments} bad ${r.bad_segments === 1 ? 'reading' : 'readings'} left out.` : 'No bad readings.' }}
          </div>
        </div>
      </div>

      <!-- Meters and intensity. -->
      <div class="flex flex-col gap-2">
        <div class="text-sm font-medium text-gray-900">Meters</div>
        <div class="text-xs text-slate-500">
          {{ ec.source.value === 'label'
            ? 'Using the devices labelled Energy on the equipment.'
            : 'No device is labelled Energy, so every device with an energy register is used. Untick any you do not want counted.' }}
        </div>
        <label v-for="m in ec.meters.value" :key="key(m)"
               class="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
          <Checkbox :model-value="ec.ticked.value.has(key(m))" @update:model-value="ec.toggle(m)"/>
          <span class="font-medium">{{ deviceName(m.device) }}</span>
          <span class="truncate font-mono text-xs text-slate-500" :title="m.metric">{{ m.metric }}</span>
          <span class="ml-auto text-xs text-slate-400">{{ m.from_power ? `${m.unit || 'power'}, integrated over time` : (m.unit || 'no unit') }}</span>
        </label>
        <div class="text-xs text-slate-500">
          <i class="fa-solid fa-leaf mr-1"></i>
          <template v-if="ec.intensity.value">
            Grid intensity from {{ deviceName(ec.intensity.value.device) }}, <span class="font-mono">{{ ec.intensity.value.metric }}</span>.
          </template>
          <template v-else>This dataset does not include a grid intensity feed.</template>
        </div>
      </div>

      <!-- Half-hour table. -->
      <Collapsible v-if="r" v-model:open="tableOpen">
        <CollapsibleTrigger as-child>
          <Button variant="ghost" size="sm" class="-ml-2">
            <i :class="['fa-solid mr-2', tableOpen ? 'fa-chevron-down' : 'fa-chevron-right']"></i>
            Half-hour table ({{ rows.length }} {{ rows.length === 1 ? 'row' : 'rows' }})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div class="mt-2 max-h-96 overflow-auto rounded-md border border-slate-200">
            <table class="w-full text-sm">
              <thead class="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th class="px-3 py-2 font-medium">Half hour</th>
                  <th class="px-3 py-2 text-right font-medium">kWh</th>
                  <th class="px-3 py-2 text-right font-medium">gCO2/kWh</th>
                  <th class="px-3 py-2 text-right font-medium">kgCO2e fixed</th>
                  <th class="px-3 py-2 text-right font-medium">kgCO2e grid</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.start" class="border-t border-slate-100 tabular-nums">
                  <td class="whitespace-nowrap px-3 py-1.5">{{ halfHour(row.start) }}</td>
                  <template v-if="row.covered">
                    <td class="px-3 py-1.5 text-right">{{ kwh(row.kwh) }}</td>
                    <td class="px-3 py-1.5 text-right">{{ row.intensity != null ? Math.round(row.intensity) : '–' }}</td>
                    <td class="px-3 py-1.5 text-right">{{ kg(row.kg_fixed) }}</td>
                    <td class="px-3 py-1.5 text-right">{{ row.grid_missing ? '–' : kg(row.kg_grid) }}</td>
                  </template>
                  <td v-else colspan="4" class="px-3 py-1.5 text-right text-xs text-amber-700">No usable readings</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  </Card>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { CARBON } from '@/lib/datasets/constants.js'
import { half_hour_rows } from '@/lib/datasets/energy.js'
import { fmt_window, fmt_time, fmt_clock } from '@/lib/datasets/model.js'
import { meter_key, fmt_amount } from './energy-logic.js'

const props = defineProps({
  record: { type: Object, required: true },
  ec: { type: Object, required: true },
})

const ds = useDatasetsStore()
const tableOpen = ref(false)

const r = computed(() => props.ec.result.value)
const rows = computed(() => r.value ? half_hour_rows(r.value.segments) : [])
const canCalculate = computed(() => ['applies', 'unknown'].includes(props.ec.applies.value.state))
const windowText = computed(() => fmt_window(props.record.from, props.record.to))
const filling = computed(() => props.record.to && Date.parse(props.record.to) > Date.now())

const confidenceDot = computed(() => ({
  high: 'bg-green-500', medium: 'bg-amber-500', low: 'bg-red-500',
})[r.value?.confidence] ?? 'bg-slate-400')

const key = meter_key
const kwh = fmt_amount
const kg = fmt_amount
const pct = v => `${Math.round((v ?? 0) * 100)}%`

function halfHour (t) {
  return `${fmt_time(t)} – ${fmt_clock(t + 30 * 60 * 1000)}`
}

function deviceName (sparkplug) {
  return ds.deviceBySparkplug[sparkplug]?.name ?? sparkplug
}
</script>
