<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One page for every kind of dataset. The tab is in the URL
     (/datasets/<uuid>/<tab>), so it survives a reload and the back
     button. Add-on results are worked out in the browser and kept here
     only while the page is open. -->
<template>
  <div v-if="!loaded" class="flex items-center justify-center gap-3 p-16 text-sm text-slate-500">
    <i class="fa-solid fa-circle-notch animate-spin"></i>Loading dataset
  </div>

  <EmptyState v-else-if="!rec" icon="database" title="Dataset not found"
              description="There is no dataset with this ID, or you do not have permission to see it.">
    <template #actions>
      <Button variant="outline" as-child>
        <RouterLink to="/datasets"><i class="fa-solid fa-arrow-left mr-2"></i>Back to Datasets</RouterLink>
      </Button>
    </template>
  </EmptyState>

  <div v-else class="flex min-w-0 flex-col">
    <!-- Header. -->
    <div class="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-200 bg-white px-4 pt-4">
      <nav class="flex min-w-0 items-center gap-2 text-sm text-slate-500" aria-label="Breadcrumb">
        <RouterLink to="/datasets" class="whitespace-nowrap hover:text-slate-900">
          <i class="fa-solid fa-database mr-1 text-xs"></i>Datasets
        </RouterLink>
        <template v-if="equipment">
          <i class="fa-solid fa-chevron-right text-[9px]"></i>
          <RouterLink v-if="!equipment.missing" :to="`/datasets/${equipment.uuid}`" class="truncate whitespace-nowrap hover:text-slate-900">{{ ds.name(equipment.uuid) }}</RouterLink>
          <span v-else class="whitespace-nowrap">Equipment you cannot see</span>
        </template>
        <i class="fa-solid fa-chevron-right text-[9px]"></i>
        <span class="truncate text-slate-900" :title="name">{{ name }}</span>
      </nav>

      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="flex flex-wrap items-center gap-2.5">
            <h1 class="min-w-0 max-w-full truncate text-2xl font-semibold leading-[30px] tracking-tight text-gray-900" :title="name">{{ name }}</h1>
            <KindBadge :kind="rec.kind"/>
            <StatusPill :record="rec" pill/>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 text-[13px] text-gray-700">
            <span class="inline-flex items-center gap-1.5">
              <i :class="['fa-solid text-xs text-slate-500', rec.created_via === 'kiosk' ? 'fa-tablet-screen-button' : 'fa-user']"></i>
              {{ rec.created_by ?? 'Unknown author' }}
            </span>
            <span class="text-slate-300">|</span>
            <span>{{ fmt_window(rec.from, rec.to) }}</span>
            <span class="text-slate-300">|</span>
            <TagChips :tags="rec.tags" :known="ds.allTags" :editable="rec.readable" @update="saveTags"/>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap gap-2">
          <Button v-if="recording" size="sm" variant="destructive" @click="stopOpen = true">
            <i class="fa-solid fa-stop mr-2"></i>Stop recording
          </Button>
          <Button size="sm" variant="outline" :disabled="downloading" @click="download">
            <i :class="['fa-solid mr-2', downloading ? 'fa-circle-notch animate-spin' : 'fa-download']"></i>Download CSV
          </Button>
          <Button v-if="grafana" size="sm" variant="outline" as-child>
            <a :href="grafana" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square mr-2"></i>Grafana</a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button size="sm" variant="outline" aria-label="More actions" title="More actions">
                <i class="fa-solid fa-ellipsis"></i>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-72">
              <template v-for="m in menu" :key="m.id">
                <DropdownMenuSeparator v-if="m.id === 'delete'"/>
                <DropdownMenuItem :disabled="!!m.reason" :class="['flex-col items-start gap-0', m.danger && 'text-red-600 focus:text-red-600']" @select="m.go">
                  <span class="flex items-center gap-2"><i :class="`fa-solid fa-fw fa-${m.icon} text-xs`"></i>{{ m.label }}</span>
                  <span v-if="m.reason" class="pl-6 text-xs text-slate-500">{{ m.reason }}</span>
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div class="-mb-px flex gap-1 overflow-x-auto" role="tablist">
        <button v-for="t in TABS" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id"
                :class="['inline-flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
                         tab === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900']"
                @click="setTab(t.id)">
          {{ t.label }}
          <span v-if="t.id === 'add-ons' && addonCount" class="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{{ addonCount }}</span>
        </button>
      </div>
    </div>

    <!-- Body. -->
    <div class="flex flex-col gap-4 p-4">
      <div v-if="ds.error" class="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
        <i class="fa-solid fa-triangle-exclamation mr-2"></i>{{ ds.error }}
      </div>

      <Alert v-if="rec.invalid" variant="destructive" class="flex items-start gap-3">
        <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
        <div>
          <AlertTitle>Invalid</AlertTitle>
          <AlertDescription class="text-gray-700">The service reports this dataset as invalid.</AlertDescription>
        </div>
      </Alert>

      <Alert v-if="rec.voided" class="flex flex-wrap items-start gap-3">
        <i class="fa-solid fa-ban mt-0.5 text-slate-500"></i>
        <div class="min-w-0 flex-1">
          <AlertTitle>Voided</AlertTitle>
          <AlertDescription class="text-gray-700">{{ voidText }}</AlertDescription>
        </div>
        <Button size="sm" variant="outline" :disabled="restoring" @click="restore">
          <i :class="['fa-solid mr-2', restoring ? 'fa-circle-notch animate-spin' : 'fa-rotate-left']"></i>Restore
        </Button>
      </Alert>

      <Alert v-if="changeText" class="flex items-start gap-3">
        <i class="fa-solid fa-circle-info mt-0.5 text-slate-500"></i>
        <div>
          <AlertTitle>Equipment changed after this recording</AlertTitle>
          <AlertDescription class="text-gray-700">{{ changeText }}</AlertDescription>
        </div>
      </Alert>

      <OverviewTab v-if="tab === 'overview'" :record="rec" :resolved="resolved" :labels="labels" :ec="ec"
                   :grafana="grafana" :downloading="downloading" @tab="setTab" @download="download"/>
      <DataTab v-else-if="tab === 'data'" :record="rec" :resolved="resolved" :downloading="downloading" @download="download"/>
      <UseTab v-else-if="tab === 'use'" :record="rec" :grafana="grafana" :downloading="downloading" @download="download"/>
      <template v-else-if="tab === 'add-ons'">
        <EnergyCarbon :record="rec" :ec="ec"/>
        <p class="text-xs text-slate-500">
          Add-ons work figures out from a dataset's data. Energy and carbon is the only one so far.
          Results are not stored, so they are worked out again each time you open this page.
        </p>
      </template>
      <StructureTab v-else-if="tab === 'structure'" :record="rec" @delete="deleteDialog?.open(rec)"/>
    </div>

    <!-- Dialogs. -->
    <Dialog :open="stopOpen" @update:open="v => stopOpen = v">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stop recording?</DialogTitle>
          <DialogDescription>
            This saves the run from {{ recording ? fmt_time(recording.startedAt) : '' }} until now
            <template v-if="recording?.startedBy">, started by {{ recording.startedBy }}</template>.
            Anyone recording at the kiosk sees it stop.
          </DialogDescription>
        </DialogHeader>
        <p v-if="stopError" class="text-sm text-red-600">{{ stopError }}</p>
        <DialogFooter>
          <Button variant="outline" @click="stopOpen = false">Keep recording</Button>
          <Button variant="destructive" :disabled="stopping" @click="stop">
            <i :class="['fa-solid mr-2', stopping ? 'fa-circle-notch animate-spin' : 'fa-stop']"></i>Stop recording
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <CorrectTimesDialog ref="timesDialog"/>
    <VoidDialog ref="voidDialog"/>
    <DeleteDatasetDialog ref="deleteDialog" @deleted="router.push('/datasets')"/>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import streamSaver from 'streamsaver'
import EmptyState from '@/components/EmptyState.vue'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { STRUCTURE } from '@/lib/datasets/constants.js'
import { display_name, fmt_window, fmt_time } from '@/lib/datasets/model.js'
import { set_tags, set_void, download_csv, edit_shape, stop_recording } from '@/lib/datasets/api.js'
import { grafana_link } from '@/lib/datasets/links.js'
import KindBadge from '@/components/Datasets/KindBadge.vue'
import StatusPill from '@/components/Datasets/StatusPill.vue'
import TagChips from '@/components/Datasets/TagChips.vue'
import DeleteDatasetDialog from '@/components/Datasets/DeleteDatasetDialog.vue'
import OverviewTab from '@/components/Datasets/page/OverviewTab.vue'
import DataTab from '@/components/Datasets/page/DataTab.vue'
import UseTab from '@/components/Datasets/page/UseTab.vue'
import StructureTab from '@/components/Datasets/page/StructureTab.vue'
import CorrectTimesDialog from '@/components/Datasets/page/CorrectTimesDialog.vue'
import VoidDialog from '@/components/Datasets/page/VoidDialog.vue'
import EnergyCarbon from '@/components/Datasets/addons/EnergyCarbon.vue'
import { useEnergyCarbon } from '@/components/Datasets/addons/useEnergyCarbon.js'
import { TABS, tab_of, equipment_of, equipment_change, labels_for } from '@/components/Datasets/page/page-logic.js'

const ds = useDatasetsStore()
const sc = useServiceClientStore()
const route = useRoute()
const router = useRouter()

onMounted(() => ds.start())
onUnmounted(() => ds.stop())

const uuid = computed(() => route.params.uuid)
const tab = computed(() => tab_of(route.params.tab))
function setTab (t) {
  router.replace(t === 'overview' ? `/datasets/${uuid.value}` : `/datasets/${uuid.value}/${t}`)
}

// Invalid datasets only come from the structure search, so wait for
// both before saying a dataset does not exist.
const rec = computed(() => ds.byUuid[uuid.value] ?? null)
const loaded = computed(() => !!rec.value || (ds.ready && ds.structureReady))
const name = computed(() => display_name(rec.value))

const resolved = computed(() => rec.value ? ds.devicesOf(uuid.value) : { devices: [], device_datasets: [], unknown: [] })
const labels = computed(() => labels_for(rec.value, ds.byUuid))
const deviceRecords = computed(() => resolved.value.devices.map(d => ds.deviceByUuid[d]).filter(Boolean))
const equipment = computed(() => equipment_of(rec.value, ds.byUuid))
const recording = computed(() => rec.value?.kind === 'equipment' && rec.value.recording?.startedAt ? rec.value.recording : null)
const grafana = computed(() => rec.value ? grafana_link(rec.value) : null)

const ec = useEnergyCarbon(rec, deviceRecords)
const addonCount = computed(() => ['applies', 'unknown'].includes(ec.applies.value.state) ? 1 : 0)

/* ------------------------------------------------------------------
 * Alerts
 * ------------------------------------------------------------------ */

const voidText = computed(() => {
  const v = rec.value?.run?.void
  if (!v) return ''
  const when = v.at ? ` ${fmt_time(v.at)}` : ''
  const who = v.by ? ` by ${v.by}` : ''
  const why = v.reason ? ` Reason: ${v.reason}.` : ''
  return `Voided${when}${who}.${why} The run and its data are kept.`
})

const changeText = computed(() => {
  const eq = equipment.value
  if (!eq || eq.missing || !eq.structure) return null
  const c = equipment_change(rec.value, ds.devicesOf(eq.uuid).device_datasets, ds.byUuid)
  if (!c || (!c.added.length && !c.removed.length)) return null
  const names = list => list.map(d => ds.deviceByUuid[d]?.name ?? 'an unknown device').join(', ')
  const parts = []
  if (c.added.length) parts.push(`Added since: ${names(c.added)}.`)
  if (c.removed.length) parts.push(`Removed since: ${names(c.removed)}.`)
  return `This run reads its data through the equipment, so it now covers the equipment's current devices. ${parts.join(' ')}`
})

/* ------------------------------------------------------------------
 * Actions
 * ------------------------------------------------------------------ */

const timesDialog = ref(null)
const voidDialog = ref(null)
const deleteDialog = ref(null)

const menu = computed(() => {
  const r = rec.value
  if (!r) return []
  const shape = edit_shape(r, ds.byUuid)
  const items = [{
    id: 'edit', label: 'Edit definition', icon: 'pen',
    reason: shape.ok ? null : shape.reason,
    go: () => router.push(`/datasets/${r.uuid}/edit`),
  }]
  if (r.kind === 'run') {
    items.push({
      id: 'times', label: 'Correct start or end time', icon: 'clock-rotate-left',
      reason: !r.editable ? 'You cannot edit this dataset.'
        : r.invalid ? 'The service reports this dataset as invalid.'
        : r.structure !== STRUCTURE.SESSION ? 'This run has no time window of its own.'
        : null,
      go: () => timesDialog.value?.open(r),
    })
    items.push(r.voided
      ? { id: 'restore', label: 'Restore', icon: 'rotate-left', reason: null, go: restore }
      : { id: 'void', label: 'Void', icon: 'ban', reason: null, go: () => voidDialog.value?.open(r) })
  }
  items.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy', reason: null, go: () => router.push(`/datasets/new?duplicate=${r.uuid}`) })
  items.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, reason: null, go: () => deleteDialog.value?.open(r) })
  return items
})

async function saveTags (tags) {
  try {
    await set_tags(sc.client, rec.value.uuid, tags)
  }
  catch (err) {
    console.error('Saving tags failed', err)
    toast.error('Tags not saved', { description: err?.status === 403 ? 'You do not have permission to change this dataset.' : (err?.message ?? 'The service refused the change.') })
  }
}

const restoring = ref(false)
async function restore () {
  restoring.value = true
  try {
    await set_void(sc.client, rec.value.uuid, {}, true)
    toast.success('Run restored')
  }
  catch (err) {
    toast.error('Not restored', { description: err?.status === 403 ? 'You do not have permission to restore this run.' : err?.message })
  }
  finally {
    restoring.value = false
  }
}

const downloading = ref(false)
async function download () {
  if (downloading.value) return
  downloading.value = true
  try {
    await download_csv(sc.client, rec.value.uuid, streamSaver)
    toast.success('Download complete')
  }
  catch (err) {
    console.error('CSV download failed', err)
    toast.error('Download failed', { description: err?.message ?? 'The service did not return the data.' })
  }
  finally {
    downloading.value = false
  }
}

const stopOpen = ref(false)
const stopping = ref(false)
const stopError = ref(null)
async function stop () {
  stopping.value = true
  stopError.value = null
  try {
    const res = await stop_recording(sc.client, { uuid: rec.value.uuid, name: rec.value.name }, { by: sc.username })
    stopOpen.value = false
    toast.success(`Saved ${res.name}`, {
      action: { label: 'Open', onClick: () => router.push(`/datasets/${res.run}`) },
    })
    if (res.problems.length) {
      toast.warning('The run is saved, but some details are not', { description: res.problems.join(' ') })
    }
  }
  catch (err) {
    stopError.value = [err?.message, err?.detail].filter(Boolean).join(' ') || 'The recording did not stop.'
  }
  finally {
    stopping.value = false
  }
}
</script>
