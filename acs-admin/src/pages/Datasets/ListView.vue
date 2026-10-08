<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Every dataset in one table: kind tabs, search, a created-by filter,
     and actions on the ticked rows (compare, group, download). Device
     datasets are hidden unless the switch is on. -->
<template>
  <div class="flex flex-col gap-3">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative w-full sm:w-80">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"></i>
        <Input v-model="search" class="pl-8 h-9" placeholder="Search names, tags, equipment..." aria-label="Search datasets"/>
      </div>
      <div class="inline-flex rounded-md bg-slate-100 p-1 text-sm" role="group" aria-label="Created by">
        <button v-for="o in CREATORS" :key="o.id" type="button"
                class="rounded px-3 py-1 transition-colors duration-150"
                :class="creator === o.id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'"
                :aria-pressed="creator === o.id" @click="creator = o.id">
          {{ o.label }}
        </button>
      </div>
      <label class="flex items-center gap-2 text-sm text-slate-600">
        <Switch v-model="showDevices"/>
        Show device datasets
      </label>
      <Button variant="ghost" size="sm" as-child>
        <RouterLink to="/datasets/add-ons"><i class="fa-solid fa-puzzle-piece mr-1.5"></i>About add-ons</RouterLink>
      </Button>
      <div class="ml-auto"><slot name="actions"/></div>
    </div>

    <!-- Kind tabs -->
    <Tabs v-model="tab">
      <TabsList class="flex-wrap h-auto">
        <TabsTrigger v-for="t in TABS" :key="t.id" :value="t.id">
          <i v-if="t.id === 'attention'" class="fa-solid fa-triangle-exclamation mr-1.5 text-red-500"></i>
          {{ t.label }}
          <span class="ml-1.5 text-xs text-slate-500">{{ counts[t.id] }}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <div v-if="tab === 'attention'" class="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
      <i class="fa-solid fa-triangle-exclamation"></i>
      The service reports these datasets as invalid.
    </div>

    <!-- Selection bar -->
    <div v-if="ticked.length" class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <span class="text-sm font-medium mr-2">{{ ticked.length }} selected</span>
      <span :title="compareWhy ?? ''">
        <Button size="sm" variant="outline" :disabled="!!compareWhy" @click="compare">
          <i class="fa-solid fa-chart-line mr-1.5"></i>Compare
        </Button>
      </span>
      <span :title="groupWhy ?? ''">
        <Button size="sm" variant="outline" :disabled="!!groupWhy" @click="saveDialog.open('process', tickedIds)">
          <i class="fa-solid fa-diagram-project mr-1.5"></i>Save as process
        </Button>
      </span>
      <span :title="groupWhy ?? ''">
        <Button size="sm" variant="outline" :disabled="!!groupWhy" @click="saveDialog.open('part', tickedIds)">
          <i class="fa-solid fa-cube mr-1.5"></i>Save as part
        </Button>
      </span>
      <Button size="sm" variant="outline" :disabled="downloading" @click="download">
        <i :class="downloading ? 'fa-solid fa-circle-notch animate-spin' : 'fa-solid fa-download'" class="mr-1.5"></i>
        {{ downloading ? `Downloading ${downloadAt} of ${ticked.length}` : 'Download' }}
      </Button>
      <Button size="sm" variant="ghost" @click="clearTicks">Clear</Button>
    </div>

    <!-- Table -->
    <div class="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-xs font-medium text-slate-500">
          <tr class="border-b border-slate-200">
            <th class="w-10 px-4 py-2.5">
              <Checkbox :model-value="headerTick" :disabled="!shown.length" aria-label="Tick all shown" @update:model-value="tickAll"/>
            </th>
            <th class="px-4 py-2.5">
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-900" @click="sortBy('name')">
                Name <i :class="sortIcon('name')"></i>
              </button>
            </th>
            <th class="px-4 py-2.5">Kind</th>
            <th class="px-4 py-2.5">Covers</th>
            <th class="px-4 py-2.5">
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-900" @click="sortBy('window')">
                Window <i :class="sortIcon('window')"></i>
              </button>
            </th>
            <th class="px-4 py-2.5">Created by</th>
            <th class="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody v-if="!ds.ready">
          <tr v-for="i in 6" :key="i" class="border-b border-slate-100 last:border-0">
            <td class="px-4 py-2.5"><Skeleton class="size-4"/></td>
            <td class="px-4 py-2.5"><Skeleton class="h-4 w-56"/></td>
            <td class="px-4 py-2.5"><Skeleton class="h-4 w-20"/></td>
            <td class="px-4 py-2.5"><Skeleton class="h-4 w-16"/></td>
            <td class="px-4 py-2.5"><Skeleton class="h-4 w-40"/></td>
            <td class="px-4 py-2.5"><Skeleton class="h-4 w-24"/></td>
            <td class="px-4 py-2.5"><Skeleton class="h-4 w-16"/></td>
          </tr>
        </tbody>
        <tbody v-else>
          <tr v-for="row in shown.slice(0, limit)" :key="row.r.uuid"
              class="cursor-pointer border-b border-slate-100 last:border-0 transition-colors duration-150 hover:bg-slate-100"
              :class="tickSet.has(row.r.uuid) ? 'bg-slate-100' : ''"
              @click="router.push(`/datasets/${row.r.uuid}`)">
            <td class="px-4 py-2.5" @click.stop>
              <Checkbox :model-value="tickSet.has(row.r.uuid)" :aria-label="`Tick ${row.name}`"
                        @update:model-value="v => tick(row.r.uuid, v)"/>
            </td>
            <td class="px-4 py-2.5 max-w-xs">
              <div class="truncate font-medium text-slate-950" :title="row.name">{{ row.name }}</div>
              <TagChips v-if="row.r.tags.length" :tags="row.r.tags" class="mt-1"/>
            </td>
            <td class="px-4 py-2.5"><KindBadge :kind="row.r.kind"/></td>
            <td class="px-4 py-2.5 whitespace-nowrap text-slate-700">{{ row.covers }}</td>
            <td class="px-4 py-2.5 whitespace-nowrap text-slate-700">{{ fmt_window(row.r.from, row.r.to) }}</td>
            <td class="px-4 py-2.5 whitespace-nowrap text-slate-700">
              <template v-if="row.r.created_by"><i class="fa-solid fa-user mr-1.5 text-xs text-slate-400"></i>{{ row.r.created_by }}</template>
              <template v-else>—</template>
            </td>
            <td class="px-4 py-2.5"><StatusPill :record="row.r"/></td>
          </tr>
        </tbody>
      </table>
      <div v-if="shown.length > limit" class="border-t border-slate-200 px-4 py-2 text-sm text-slate-500">
        Showing {{ limit }} of {{ shown.length }}.
        <button type="button" class="ml-1 font-medium text-slate-900 hover:underline" @click="limit += PAGE">Show {{ Math.min(PAGE, shown.length - limit) }} more</button>
      </div>

      <div v-if="ds.ready && !shown.length" class="flex flex-col items-center gap-3 px-4 py-12 text-center">
        <i class="fa-solid fa-database text-2xl text-slate-300"></i>
        <template v-if="filtered">
          <p class="text-sm text-slate-500">No datasets match.</p>
          <Button size="sm" variant="outline" @click="clearFilters">Clear filters</Button>
        </template>
        <p v-else-if="tab === 'attention'" class="text-sm text-slate-500">No datasets need attention.</p>
        <p v-else class="text-sm text-slate-500">No datasets yet. Use New dataset to make one.</p>
      </div>
    </div>

    <SaveGroupDialog ref="saveDialog" @saved="clearTicks"/>
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import streamSaver from 'streamsaver'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import KindBadge from '@/components/Datasets/KindBadge.vue'
import StatusPill from '@/components/Datasets/StatusPill.vue'
import TagChips from '@/components/Datasets/TagChips.vue'
import SaveGroupDialog from '@/components/Datasets/list/SaveGroupDialog.vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { display_name, direct_sources, fmt_window, matches } from '@/lib/datasets/model.js'
import { download_csv } from '@/lib/datasets/api.js'
import { comparable, compare_problem, group_problem } from '@/lib/datasets/compare.js'

const TABS = [
  { id: 'all',       label: 'All' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'run',       label: 'Runs' },
  { id: 'process',   label: 'Processes' },
  { id: 'part',      label: 'Parts' },
  { id: 'other',     label: 'Other' },
  { id: 'attention', label: 'Needs attention' },
]

const CREATORS = [
  { id: 'anyone', label: 'Anyone' },
  { id: 'me',     label: 'Me' },
]

const ds = useDatasetsStore()
const sc = useServiceClientStore()
const router = useRouter()

const tab = ref('all')
const search = ref('')
const creator = ref('anyone')
const showDevices = ref(false)
const sort = reactive({ key: 'window', desc: true })
const tickSet = reactive(new Set())
const saveDialog = ref(null)
const downloading = ref(false)
const downloadAt = ref(0)

/* Rows with what the table and search need, worked out once per change. */
const rows = computed(() => {
  const base = showDevices.value ? ds.all : ds.visible
  return base.map(r => {
    let covers = '—'
    const extra = []
    if (r.kind === 'process' || r.kind === 'part') {
      const n = direct_sources(r).length
      if (n) covers = `${n} ${n === 1 ? 'dataset' : 'datasets'}`
    }
    else {
      const devs = ds.devicesOf(r.uuid).devices
      if (devs.length) covers = `${devs.length} ${devs.length === 1 ? 'device' : 'devices'}`
      for (const d of devs) {
        const dev = ds.deviceByUuid[d]
        if (dev) extra.push(dev.name)
      }
    }
    const eq = r.run?.equipment ?? (r.config?.source && ds.byUuid[r.config.source]?.kind === 'equipment' ? r.config.source : null)
    if (eq) extra.push(ds.name(eq))
    if (r.created_by) extra.push(r.created_by)
    return { r, name: display_name(r), covers, extra, start: r.from ? Date.parse(r.from) : null }
  })
})

/* Search and created-by, before the kind tab, so the tab counts follow them. */
const narrowed = computed(() => rows.value.filter(row =>
  (creator.value !== 'me' || (sc.username && row.r.created_by === sc.username))
  && matches(row.r, search.value, row.extra)))

function inTab (r, t) {
  if (t === 'all') return true
  if (t === 'attention') return r.invalid
  if (t === 'other') return r.kind === 'other' || r.kind === 'device'
  return r.kind === t
}

const counts = computed(() => Object.fromEntries(TABS.map(t => [t.id, narrowed.value.filter(row => inTab(row.r, t.id)).length])))

// Render a page of rows at a time; there can be hundreds.
const PAGE = 200
const limit = ref(PAGE)
watch([tab, search, creator], () => { limit.value = PAGE })

const shown = computed(() => {
  const list = narrowed.value.filter(row => inTab(row.r, tab.value))
  const dir = sort.desc ? -1 : 1
  if (sort.key === 'name') return list.sort((a, b) => dir * a.name.localeCompare(b.name))
  // Datasets without a start go last either way.
  return list.sort((a, b) => {
    if (a.start == null || b.start == null) return (a.start == null) - (b.start == null)
    return dir * (a.start - b.start)
  })
})

const filtered = computed(() => !!search.value.trim() || creator.value !== 'anyone')

function sortBy (key) {
  if (sort.key === key) sort.desc = !sort.desc
  else { sort.key = key; sort.desc = key === 'window' }
}

function sortIcon (key) {
  if (sort.key !== key) return 'fa-solid fa-sort text-slate-300'
  return sort.desc ? 'fa-solid fa-sort-down' : 'fa-solid fa-sort-up'
}

function clearFilters () {
  search.value = ''
  creator.value = 'anyone'
}

/* ------------------------------------------------------------------
 * Ticks and actions
 * ------------------------------------------------------------------ */

const ticked = computed(() => [...tickSet].map(id => ds.byUuid[id]).filter(Boolean))
const tickedIds = computed(() => ticked.value.map(r => r.uuid))
const compareWhy = computed(() => compare_problem(ticked.value))
const groupWhy = computed(() => group_problem(ticked.value))

// Forget ticks on datasets that have gone.
watch(() => ds.byUuid, by => { for (const id of [...tickSet]) if (!by[id]) tickSet.delete(id) })

const headerTick = computed(() => {
  const n = shown.value.filter(row => tickSet.has(row.r.uuid)).length
  if (!n) return false
  return n === shown.value.length ? true : 'indeterminate'
})

function tick (uuid, on) {
  if (on) tickSet.add(uuid)
  else tickSet.delete(uuid)
}

function tickAll (on) {
  for (const row of shown.value) tick(row.r.uuid, on === true)
}

function clearTicks () {
  tickSet.clear()
}

function compare () {
  const ids = comparable(ticked.value).map(r => r.uuid)
  router.push({ path: '/datasets/compare', query: { ids: ids.join(',') } })
}

// One file after another, so the browser does not block a burst of downloads.
async function download () {
  downloading.value = true
  const list = [...ticked.value]
  let failed = 0
  try {
    for (let i = 0; i < list.length; i++) {
      downloadAt.value = i + 1
      try {
        await download_csv(sc.client, list[i].uuid, streamSaver)
      }
      catch (err) {
        failed++
        toast.error(`${display_name(list[i])}: ${err.message ?? 'The download failed.'}`)
      }
    }
    if (!failed) toast.success(list.length === 1 ? 'Download finished' : `${list.length} downloads finished`)
  }
  finally {
    downloading.value = false
  }
}
</script>
