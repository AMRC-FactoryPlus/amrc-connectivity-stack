<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Compare runs one raw metric at a time. Each run's CSV is fetched
     and parsed in the browser, and each line is aligned to its run's
     start. The runs are kept in the URL (?ids=a,b,c). -->
<template>
  <div class="flex flex-col gap-4">
    <RouterLink to="/datasets?view=list" class="inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
      <i class="fa-solid fa-arrow-left"></i>Datasets
    </RouterLink>

    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold tracking-tight text-gray-900">Compare {{ ids.length }} {{ ids.length === 1 ? 'run' : 'runs' }}</h1>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" @click="adding = true">
          <i class="fa-solid fa-plus mr-1.5"></i>Add runs
        </Button>
        <span :title="groupWhy ?? ''">
          <Button size="sm" variant="outline" :disabled="!!groupWhy" @click="saveDialog.open('part', ids)">
            <i class="fa-solid fa-cube mr-1.5"></i>Save as part
          </Button>
        </span>
        <span :title="groupWhy ?? ''">
          <Button size="sm" variant="outline" :disabled="!!groupWhy" @click="saveDialog.open('process', ids)">
            <i class="fa-solid fa-diagram-project mr-1.5"></i>Save as process
          </Button>
        </span>
      </div>
    </div>

    <!-- Runs -->
    <div class="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs font-medium text-slate-500">
          <tr class="border-b border-slate-200">
            <th class="w-12 px-4 py-2.5"><span class="sr-only">Line</span></th>
            <th class="px-4 py-2.5">Run</th>
            <th class="px-4 py-2.5">Start</th>
            <th class="px-4 py-2.5">Duration</th>
            <th class="px-4 py-2.5">Devices</th>
            <th class="px-4 py-2.5">Data</th>
            <th class="w-10 px-4 py-2.5"><span class="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in runRows" :key="row.uuid" class="border-b border-slate-100 last:border-0">
            <td class="px-4 py-2.5"><LineSwatch :line-style="line_style(i)"/></td>
            <td class="px-4 py-2.5 max-w-xs">
              <RouterLink v-if="row.r" :to="`/datasets/${row.uuid}`" class="block truncate font-medium text-slate-950 hover:underline" :title="row.name">
                {{ row.name }}
              </RouterLink>
              <span v-else class="block truncate text-slate-500">{{ ds.ready ? 'A dataset you cannot see' : 'Loading...' }}</span>
              <TagChips v-if="row.r?.tags.length" :tags="row.r.tags" class="mt-1"/>
            </td>
            <td class="px-4 py-2.5 whitespace-nowrap text-slate-700">{{ row.r?.from ? fmt_time(row.r.from) : '—' }}</td>
            <td class="px-4 py-2.5 whitespace-nowrap text-slate-700">{{ row.duration }}</td>
            <td class="px-4 py-2.5 whitespace-nowrap text-slate-700">{{ row.devices }}</td>
            <td class="px-4 py-2.5 whitespace-nowrap">
              <span v-if="row.load?.status === 'loading'" class="text-slate-500">
                <i class="fa-solid fa-circle-notch animate-spin mr-1.5"></i>Loading
              </span>
              <span v-else-if="row.load?.status === 'error'" class="text-red-600" :title="row.load.error">
                <i class="fa-solid fa-triangle-exclamation mr-1.5"></i>{{ row.load.error }}
              </span>
              <span v-else-if="row.load?.status === 'ready'" class="text-slate-700">
                {{ row.load.rows.toLocaleString('en-GB') }} rows
              </span>
            </td>
            <td class="px-4 py-2.5">
              <button type="button" class="text-slate-400 hover:text-slate-900" :aria-label="`Remove ${row.name}`" @click="remove(row.uuid)">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </td>
          </tr>
          <tr v-if="!ids.length">
            <td colspan="7" class="px-4 py-10 text-center text-sm text-slate-500">
              No runs to compare. Use Add runs to choose some.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Chart -->
    <div v-if="ids.length" class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="text-base font-semibold text-gray-900 mr-2">Metric</h2>
        <Input v-if="metrics.length > 12" v-model="metricSearch" class="h-8 w-56" placeholder="Filter metrics..." aria-label="Filter metrics"/>
      </div>

      <div v-if="anyLoading && !metrics.length" class="flex items-center gap-2 py-8 text-sm text-slate-500">
        <i class="fa-solid fa-circle-notch animate-spin"></i>Loading run data. Large runs take a while.
      </div>
      <p v-else-if="!metrics.length" class="py-8 text-sm text-slate-500">
        {{ readyCount ? 'The runs share no metrics.' : 'No run data to show.' }}
      </p>

      <template v-else>
        <div class="flex flex-wrap gap-1" role="tablist" aria-label="Metrics">
          <button v-for="m in shownMetrics" :key="m.key" type="button" role="tab"
                  class="max-w-xs truncate rounded px-2.5 py-1 text-sm transition-colors duration-150"
                  :class="m.key === metric ? 'bg-slate-900 text-slate-50' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'"
                  :aria-selected="m.key === metric" :title="m.title" @click="metric = m.key">
            {{ m.label }}
          </button>
          <span v-if="!shownMetrics.length" class="text-sm text-slate-500">No metrics match.</span>
        </div>

        <p v-if="anyLoading" class="text-xs text-slate-500">
          <i class="fa-solid fa-circle-notch animate-spin mr-1"></i>Some runs are still loading. The metric list updates as they finish.
        </p>

        <CompareChart v-if="lines.length" :lines="lines" :unit="unit"/>
        <p v-else class="py-8 text-sm text-slate-500">This metric is not numeric.</p>

        <ul v-if="lines.length && notNumeric.length" class="text-sm text-slate-500">
          <li v-for="n in notNumeric" :key="n">{{ n }}: this metric is not numeric.</li>
        </ul>
        <p v-if="ids.length === 1" class="text-sm text-slate-500">Add another run to compare.</p>
      </template>
    </div>

    <AddRunsDialog v-model:open="adding" :exclude="ids" @add="addRuns"/>
    <SaveGroupDialog ref="saveDialog"/>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, markRaw, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TagChips from '@/components/Datasets/TagChips.vue'
import SaveGroupDialog from '@/components/Datasets/list/SaveGroupDialog.vue'
import CompareChart from '@/components/Datasets/compare/CompareChart.vue'
import LineSwatch from '@/components/Datasets/compare/LineSwatch.vue'
import AddRunsDialog from '@/components/Datasets/compare/AddRunsDialog.vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { display_name, fmt_time, fmt_duration } from '@/lib/datasets/model.js'
import { fetch_csv } from '@/lib/datasets/api.js'
import { metric_labels } from '@/lib/datasets/series.js'
import { parse_csv } from '@/lib/datasets/energy.js'
import {
  metric_series, common_metrics, is_numeric, align, downsample, line_style, group_problem,
} from '@/lib/datasets/compare.js'

const ds = useDatasetsStore()
const route = useRoute()
const router = useRouter()

const adding = ref(false)
const saveDialog = ref(null)
const metric = ref(null)
const metricSearch = ref('')

const ids = computed(() => [...new Set(String(route.query.ids ?? '').split(',').map(s => s.trim()).filter(Boolean))])

function setIds (list) {
  router.replace({ query: { ...route.query, ids: list.length ? list.join(',') : undefined } })
}

function remove (uuid) {
  setIds(ids.value.filter(id => id !== uuid))
}

function addRuns (list) {
  setIds([...ids.value, ...list.filter(id => !ids.value.includes(id))])
}

const groupWhy = computed(() => {
  if (!ds.ready) return 'Loading datasets.'
  if (!ids.value.length) return 'Add at least one run.'
  return group_problem(ids.value.map(id => ds.byUuid[id] ?? { uuid: id }))
})

/* ------------------------------------------------------------------
 * Loading each run's data
 * ------------------------------------------------------------------ */

// uuid -> { status: loading | ready | error, error, rows, metrics }
// `metrics` is a large Map, kept out of Vue's reactivity.
const loads = reactive({})
let left = false

async function load (uuid) {
  loads[uuid] = { status: 'loading', error: null, rows: 0, metrics: null }
  try {
    await serviceClientReady()
    const text = await fetch_csv(useServiceClientStore().client, uuid)
    if (left || !ids.value.includes(uuid)) return
    const rows = parse_csv(text)
    loads[uuid] = { status: 'ready', error: null, rows: rows.length, metrics: markRaw(metric_series(rows)) }
  }
  catch (err) {
    if (left || !ids.value.includes(uuid)) return
    loads[uuid] = { status: 'error', error: err.message ?? 'Could not load the data.', rows: 0, metrics: null }
  }
}

watch(ids, list => {
  for (const id of list) if (!loads[id]) load(id)
  // Free the data of runs taken out.
  for (const id of Object.keys(loads)) if (!list.includes(id)) delete loads[id]
}, { immediate: true })

onMounted(() => ds.start())
onUnmounted(() => {
  // Results that arrive after this are dropped.
  left = true
  ds.stop()
})

const anyLoading = computed(() => ids.value.some(id => loads[id]?.status === 'loading'))
const ready = computed(() => ids.value.filter(id => loads[id]?.status === 'ready'))
const readyCount = computed(() => ready.value.length)

/* ------------------------------------------------------------------
 * Table rows
 * ------------------------------------------------------------------ */

const runRows = computed(() => ids.value.map(uuid => {
  const r = ds.byUuid[uuid] ?? null
  const from = r?.from ? Date.parse(r.from) : null
  const to = r?.to ? Date.parse(r.to) : null
  const n = r ? ds.devicesOf(uuid).devices.length : null
  return {
    uuid,
    r,
    name: r ? display_name(r) : uuid,
    duration: from != null && to != null ? fmt_duration(to - from) : '—',
    devices: n == null ? '—' : String(n),
    load: loads[uuid],
  }
}))

/* ------------------------------------------------------------------
 * Metrics and lines
 * ------------------------------------------------------------------ */

function device_name (s) {
  return ds.deviceBySparkplug[s.device]?.name ?? s.device
}

// Metrics every loaded run has. Numeric ones first. Labels are short
// and readable; the full path shows on hover.
const metrics = computed(() => {
  const maps = ready.value.map(id => loads[id].metrics)
  const keys = common_metrics(maps)
  const paths = new Map()
  for (const key of keys) {
    const s = maps[0].get(key)
    paths.set(s.device, [...(paths.get(s.device) ?? []), s.metric])
  }
  const labels = new Map([...paths].map(([d, list]) => [d, metric_labels(list)]))
  return keys
    .map(key => {
      const s = maps[0].get(key)
      const dev = device_name(s)
      const short = labels.get(s.device)?.get(s.metric) ?? s.metric
      return {
        key,
        label: dev ? `${dev} / ${short}` : short,
        title: dev ? `${dev} / ${s.metric}` : s.metric,
        numeric: maps.every(m => is_numeric(m.get(key))),
      }
    })
    .sort((a, b) => (b.numeric - a.numeric) || a.label.localeCompare(b.label))
})

const shownMetrics = computed(() => {
  const q = metricSearch.value.trim().toLowerCase()
  return q ? metrics.value.filter(m => `${m.label} ${m.title}`.toLowerCase().includes(q)) : metrics.value
})

// Keep the chosen metric while it is still offered.
watch(metrics, list => {
  if (!list.some(m => m.key === metric.value)) metric.value = list[0]?.key ?? null
}, { immediate: true })

const unit = computed(() => {
  for (const id of ready.value) {
    const u = loads[id].metrics.get(metric.value)?.unit
    if (u) return u
  }
  return ''
})

const lines = computed(() => {
  if (!metric.value) return []
  const out = []
  ids.value.forEach((id, i) => {
    const s = loads[id]?.status === 'ready' ? loads[id].metrics.get(metric.value) : null
    const r = ds.byUuid[id]
    if (!s || !is_numeric(s) || !r?.from) return
    out.push({
      name: display_name(r),
      style: line_style(i),
      pairs: downsample(align(s.points, Date.parse(r.from)), 2000),
    })
  })
  return out
})

const notNumeric = computed(() => ready.value
  .filter(id => metric.value && !is_numeric(loads[id].metrics.get(metric.value)))
  .map(id => ds.name(id)))
</script>
