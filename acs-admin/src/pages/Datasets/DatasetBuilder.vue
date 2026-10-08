<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The dataset builder. One page for four ways in:
       /datasets/new                       a new dataset
       /datasets/new?duplicate=<uuid>      a copy of another
       /datasets/new?devices=..&from=&to=  a timeline selection
       /datasets/:uuid/edit                change an existing one
     Picked devices become device datasets only when you save. A failed
     save keeps the form as it is and says what, if anything, was saved. -->
<template>
  <div class="flex max-w-[1280px] flex-col gap-4">
    <div v-if="!loaded" class="flex items-center gap-2 p-6 text-sm text-slate-500">
      <i class="fa-solid fa-circle-notch animate-spin"></i>Loading datasets
    </div>

    <!-- Editing something that cannot be found or changed in place. -->
    <template v-else-if="mode === 'edit' && (!record || !shape.ok)">
      <div>
        <button type="button" class="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900" @click="cancel">
          <i class="fa-solid fa-arrow-left text-[11px]"></i>Back
        </button>
        <h2 class="text-2xl font-semibold leading-[30px] tracking-tight">Edit dataset</h2>
      </div>
      <Alert class="max-w-2xl">
        <AlertTitle>
          <i class="fa-solid fa-circle-info mr-2 text-slate-500"></i>
          {{ record ? 'This dataset cannot be edited here' : 'Dataset not found' }}
        </AlertTitle>
        <AlertDescription class="text-slate-700">
          {{ record ? shape.reason : 'It may have been deleted, or you may not have access to it.' }}
        </AlertDescription>
        <div class="mt-3 flex gap-2">
          <Button v-if="record" size="sm" @click="router.push(`/datasets/new?duplicate=${record.uuid}`)">
            <i class="fa-solid fa-copy mr-2"></i>Duplicate
          </Button>
          <Button size="sm" variant="outline" @click="cancel">Back</Button>
        </div>
      </Alert>
    </template>

    <div v-else class="flex flex-wrap items-start gap-6">
      <!-- Form -->
      <div class="flex min-w-0 flex-[3_1_520px] flex-col gap-5">
        <div>
          <button type="button" class="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900" @click="cancel">
            <i class="fa-solid fa-arrow-left text-[11px]"></i>Back
          </button>
          <h2 class="truncate text-2xl font-semibold leading-[30px] tracking-tight" :title="title">{{ title }}</h2>
        </div>

        <Alert v-if="saveError" variant="destructive">
          <AlertTitle><i class="fa-solid fa-circle-exclamation mr-2"></i>{{ saveError.message }}</AlertTitle>
          <AlertDescription class="text-slate-700">
            <p v-if="saveError.detail">{{ saveError.detail }}</p>
            <div v-if="saveError.saved?.length" class="mt-2">
              <p>Saved before the failure:</p>
              <ul class="mt-1 list-disc pl-5">
                <li v-for="s in saveError.saved" :key="s">
                  <RouterLink v-if="isUuid(s)" :to="`/datasets/${s}`" class="underline">{{ ds.byUuid[s] ? ds.name(s) : s }}</RouterLink>
                  <span v-else>{{ s }}</span>
                </li>
              </ul>
            </div>
          </AlertDescription>
        </Alert>

        <Alert v-if="mode === 'edit' && includers.length">
          <AlertTitle><i class="fa-solid fa-circle-info mr-2 text-slate-500"></i>Others include this dataset</AlertTitle>
          <AlertDescription class="text-slate-700">
            {{ includers.length }} other {{ includers.length === 1 ? 'dataset includes' : 'datasets include' }} this one. They change too.
          </AlertDescription>
        </Alert>

        <Alert v-if="emptyDuplicate">
          <AlertTitle><i class="fa-solid fa-circle-info mr-2 text-slate-500"></i>Add the devices again</AlertTitle>
          <AlertDescription class="text-slate-700">You cannot see what the original is made of, so the copy starts with no devices.</AlertDescription>
        </Alert>

        <!-- 1. Name it -->
        <section class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div class="text-base font-semibold">1. Name it</div>
          <div class="flex flex-col gap-1.5">
            <label for="ds-name" class="text-sm font-medium">Name</label>
            <input id="ds-name" v-model="form.name" :class="inputClass" placeholder="For example, Rig 2 and extraction, last Tuesday"/>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="ds-desc" class="text-sm font-medium">Description <span class="font-normal text-slate-400">optional</span></label>
            <input id="ds-desc" v-model="form.description" :class="inputClass" placeholder="What is it for?"/>
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">Kind <span class="font-normal text-slate-400">optional</span></span>
            <div class="inline-flex flex-wrap self-start rounded-md bg-slate-100 p-1" role="radiogroup" aria-label="Kind">
              <button v-for="k in kindOptions" :key="k.id ?? 'none'" type="button" role="radio" :aria-checked="form.kind === k.id"
                      class="rounded px-3 py-1.5 text-sm font-medium transition-colors"
                      :class="form.kind === k.id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'"
                      @click="setKind(k.id)">
                {{ k.label }}
              </button>
            </div>
            <div class="text-xs text-slate-500">{{ kindHelp }}</div>
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-sm font-medium">Tags <span class="font-normal text-slate-400">optional</span></span>
            <TagChips :tags="form.tags" editable :known="ds.allTags" @update="t => form.tags = t"/>
          </div>
        </section>

        <!-- 2. What it covers -->
        <section class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div class="text-base font-semibold">2. What it covers</div>
              <div class="text-sm text-slate-500">{{ coverHelp }}</div>
            </div>
            <div class="flex shrink-0 gap-2">
              <Button v-if="!isGroup" variant="outline" size="sm" @click="devicePicker = true">
                <i class="fa-solid fa-microchip mr-2"></i>Add devices
              </Button>
              <Button v-if="form.kind !== 'equipment'" variant="outline" size="sm" @click="datasetPicker = true">
                <i class="fa-solid fa-layer-group mr-2"></i>{{ isGroup ? 'Add runs' : 'Add datasets' }}
              </Button>
            </div>
          </div>
          <div class="flex flex-col rounded-md border border-slate-200">
            <div v-for="(it, i) in form.items" :key="item_key(it)"
                 class="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
              <i :class="`fa-solid fa-fw fa-${rowOf(it).icon} text-xs text-slate-500`"></i>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 font-medium">
                  <span class="truncate" :title="rowOf(it).name">{{ rowOf(it).name }}</span>
                  <template v-if="rowOf(it).status">
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="rowOf(it).status.dot"></span>
                    <span class="whitespace-nowrap text-[11px] font-normal text-slate-500">{{ rowOf(it).status.label }}</span>
                  </template>
                </div>
                <div class="truncate text-xs text-slate-500">{{ rowOf(it).sub }}</div>
              </div>
              <input v-if="form.kind === 'equipment' && it.type === 'device'" v-model="it.label"
                     :aria-label="`Label for ${rowOf(it).name}`" placeholder="Label, e.g. Energy"
                     class="h-8 w-44 rounded-md border border-slate-200 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-950"/>
              <button type="button" class="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                      :aria-label="`Remove ${rowOf(it).name}`" title="Remove" @click="form.items.splice(i, 1)">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div v-if="!form.items.length" class="p-6 text-center text-sm text-slate-500">Nothing added yet.</div>
          </div>
          <div v-if="repeats.length" class="text-xs text-amber-700">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i>
            {{ repeats.length === 1 ? 'One device is' : `${repeats.length} devices are` }} reached by more than one item
            ({{ repeats.slice(0, 3).map(deviceName).join(', ') }}<template v-if="repeats.length > 3">, and {{ repeats.length - 3 }} more</template>).
            The CSV repeats their rows.
          </div>
        </section>

        <!-- 3. Time window -->
        <section v-if="showWindow" class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <div class="text-base font-semibold">3. Time window</div>
            <div class="text-sm text-slate-500">Leave it ongoing, or limit it to a window. Times are UK time (Europe/London).</div>
          </div>
          <div class="inline-flex self-start rounded-md bg-slate-100 p-1">
            <button v-for="m in windowModes" :key="m.id" type="button" :disabled="m.disabled" :title="m.why"
                    class="rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    :class="form.window_mode === m.id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'"
                    @click="setWindowMode(m.id)">
              {{ m.label }}
            </button>
          </div>
          <div v-if="mode === 'edit'" class="text-xs text-slate-500">
            To add or remove the window, duplicate the dataset.
          </div>
          <template v-if="form.window_mode === 'window'">
            <div class="flex flex-wrap gap-1.5">
              <button v-for="q in QUICK" :key="q.id" type="button"
                      class="h-8 rounded-md border px-3 text-sm transition-colors"
                      :class="form.quick === q.id ? 'border-slate-900 bg-slate-900 text-slate-50' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'"
                      @click="setQuick(q.id)">
                {{ q.label }}
              </button>
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="flex flex-col gap-1.5">
                <label for="ds-from" class="text-sm font-medium">From</label>
                <input id="ds-from" v-model="fromLocal" type="datetime-local" :class="inputClass"/>
              </div>
              <div class="flex flex-col gap-1.5">
                <label for="ds-to" class="text-sm font-medium">To</label>
                <input id="ds-to" v-model="toLocal" type="datetime-local" :class="inputClass"/>
              </div>
            </div>
            <p v-if="windowError" class="text-sm text-red-600">{{ windowError }}</p>
            <div v-else-if="isoWindow" class="text-sm">
              <div class="font-medium">{{ fmt_window(form.from, form.to) }}</div>
              <div class="break-all font-mono text-xs text-slate-500">
                Stored as {{ isoWindow.from }} to {{ isoWindow.to }} (UTC, both inclusive)
              </div>
              <div v-if="form.to > now" class="mt-1 text-xs text-slate-600">
                <i class="fa-solid fa-clock mr-1 text-slate-400"></i>The end is in the future. The dataset fills in as data arrives.
              </div>
            </div>
          </template>
        </section>

        <!-- Footer -->
        <div class="flex flex-wrap items-center justify-end gap-2">
          <span v-if="touched && problemList.length" class="mr-auto text-sm text-red-600">{{ problemList.join(' ') }}</span>
          <Button variant="outline" :disabled="saving" @click="cancel">Cancel</Button>
          <Button :disabled="saving" @click="save">
            <i :class="`fa-solid ${saving ? 'fa-circle-notch animate-spin' : 'fa-check'} mr-2`"></i>
            {{ mode === 'edit' ? 'Save changes' : 'Create dataset' }}
          </Button>
        </div>
      </div>

      <!-- Rail -->
      <BuilderRail class="min-w-0 flex-[1_1_300px] lg:sticky lg:top-4" :items="form.items" :rows="storeRows"
                   :window="isoWindow"/>
    </div>

    <DevicePickerDialog v-model:open="devicePicker" :added="addedDevices" @add="addDevices"/>
    <DatasetPickerDialog v-model:open="datasetPicker" :added="addedDatasets" :runs-only="isGroup"
                         :exclude="pickerExclude" @add="addDatasets"/>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { KINDS, KIND_BY_ID, kind_info } from '@/lib/datasets/constants.js'
import {
  quick_window, london_local_to_ms, ms_to_london_local, fmt_window, fmt_time, included_in,
} from '@/lib/datasets/model.js'
import {
  plan, create_from_spec, update_from_spec, edit_shape, ensure_device_datasets, DatasetError,
} from '@/lib/datasets/api.js'
import {
  empty_state, state_from_record, state_from_query, item_key, item_for, dedupe_items,
  repeated_devices, item_datasets, labels_by_dataset, shows_window, window_of, window_problem,
  problems, store_rows, GROUP_KINDS,
} from '@/components/Datasets/builder/builder.js'
import TagChips from '@/components/Datasets/TagChips.vue'
import BuilderRail from '@/components/Datasets/builder/BuilderRail.vue'
import DevicePickerDialog from '@/components/Datasets/DevicePickerDialog.vue'
import DatasetPickerDialog from '@/components/Datasets/DatasetPickerDialog.vue'

const QUICK = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last24', label: 'Last 24 hours' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'custom', label: 'Custom' },
]

const inputClass = 'h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2'

const ds = useDatasetsStore()
const route = useRoute()
const router = useRouter()

const form = reactive(empty_state())
const touched = ref(false)
const saving = ref(false)
const saveError = ref(null)
const emptyDuplicate = ref(false)
const devicePicker = ref(false)
const datasetPicker = ref(false)
const now = ref(Date.now())
let clock = null

onMounted(() => {
  ds.start()
  clock = setInterval(() => { now.value = Date.now() }, 30 * 1000)
})
onUnmounted(() => {
  ds.stop()
  clearInterval(clock)
})

/* ---------- Mode and prefill ---------- */

const mode = computed(() => route.params.uuid ? 'edit' : 'new')
const loaded = computed(() => ds.ready && ds.structureReady)
const record = computed(() => mode.value === 'edit' ? ds.byUuid[route.params.uuid] ?? null : null)
const shape = computed(() => record.value ? edit_shape(record.value, ds.byUuid) : { ok: false })
// The edit shape that limits the form, or null for a new dataset.
const editShape = computed(() => mode.value === 'edit' && shape.value.ok ? shape.value : null)

// Fill the form once per route, after the store has loaded. Later
// store updates must not overwrite what the person has typed.
let filledFor = null
// An edit waits for its record, which can arrive after the first load.
watch([loaded, () => route.fullPath, () => !!record.value], () => {
  if (!loaded.value || filledFor === route.fullPath) return
  if (mode.value === 'edit' && !record.value) return
  filledFor = route.fullPath
  fill()
}, { immediate: true })

function fill () {
  let next = empty_state()
  emptyDuplicate.value = false
  if (mode.value === 'edit') {
    if (record.value) next = state_from_record(record.value, ds.byUuid)
  }
  else if (route.query.duplicate) {
    const src = ds.byUuid[route.query.duplicate]
    if (src) {
      next = state_from_record(src, ds.byUuid, { copy: true })
      emptyDuplicate.value = !next.items.length
    }
  }
  else {
    next = state_from_query(route.query, ds.byUuid)
  }
  Object.assign(form, next)
  touched.value = false
  saveError.value = null
}

const title = computed(() => {
  if (mode.value === 'edit') return `Edit ${record.value?.name ?? 'dataset'}`
  if (route.query.duplicate) return 'Duplicate dataset'
  return 'New dataset'
})

/* ---------- Kind ---------- */

const kindOptions = [{ id: null, label: 'No kind' }, ...KINDS.map(k => ({ id: k.id, label: k.label }))]
const kindHelp = computed(() => KIND_BY_ID[form.kind]?.help ?? 'A plain dataset for any purpose.')
const isGroup = computed(() => GROUP_KINDS.includes(form.kind))

function setKind (id) {
  form.kind = id
  if (editShape.value) return
  if (id === 'run' && form.window_mode !== 'window') setWindowMode('window')
}

const coverHelp = computed(() => {
  if (form.kind === 'equipment') return 'Pick the devices that belong to this equipment. Labels are optional. The energy add-on looks for a device labelled Energy.'
  if (isGroup.value) return `Add the runs this ${form.kind} groups together.`
  return 'Pick devices, other datasets, or both.'
})

/* ---------- Items ---------- */

const addedDevices = computed(() => form.items.filter(i => i.type === 'device').map(i => i.uuid))
const addedDatasets = computed(() => form.items.filter(i => i.type === 'dataset').map(i => i.uuid))
const pickerExclude = computed(() => editShape.value ? [record.value.uuid, editShape.value.items_uuid] : [])

function addDevices (uuids) {
  form.items = dedupe_items([...form.items, ...uuids.map(uuid => ({ type: 'device', uuid, label: '' }))])
}

function addDatasets (uuids) {
  form.items = dedupe_items([...form.items, ...uuids.map(u => item_for(u, ds.byUuid))])
}

function deviceName (uuid) {
  return ds.deviceByUuid[uuid]?.name ?? `Device ${uuid.slice(0, 8)}`
}

function statusOf (d) {
  if (!d?.status) return null
  if (d.status.online) return { label: 'Online', dot: 'bg-green-500' }
  const since = d.status.last_change ? ` since ${fmt_time(d.status.last_change)}` : ''
  return { label: `Offline${since}`, dot: 'bg-slate-400' }
}

// What each item row shows.
function rowOf (it) {
  if (it.type === 'device') {
    const d = ds.deviceByUuid[it.uuid]
    const n = d?.metrics?.length ?? 0
    return {
      icon: 'microchip',
      name: deviceName(it.uuid),
      sub: ['Device', d?.area, `${n} ${n === 1 ? 'metric' : 'metrics'}`].filter(Boolean).join(' · '),
      status: statusOf(d),
    }
  }
  const r = ds.byUuid[it.uuid]
  if (!r) return { icon: 'triangle-exclamation', name: 'Missing dataset', sub: it.uuid, status: null }
  const devs = ds.devicesOf(it.uuid).devices.length
  return {
    icon: kind_info(r.kind).icon,
    name: ds.name(it.uuid),
    sub: [kind_info(r.kind).label, `${devs} ${devs === 1 ? 'device' : 'devices'}`, fmt_window(r.from, r.to)].join(' · '),
    status: null,
  }
}

const repeats = computed(() => repeated_devices(form.items, ds.byUuid))

const includers = computed(() => record.value ? included_in(record.value.uuid, ds.byUuid) : [])

/* ---------- Window ---------- */

const showWindow = computed(() => shows_window(form, editShape.value))

const windowModes = computed(() => {
  const locked = editShape.value ? 'To change this, duplicate the dataset.' : null
  return [
    { id: 'none', label: 'No time window', disabled: !!locked || form.kind === 'run', why: locked ?? (form.kind === 'run' ? 'A run needs a time window.' : '') },
    { id: 'window', label: 'Limit to a time window', disabled: !!locked, why: locked ?? '' },
  ]
})

function setWindowMode (id) {
  form.window_mode = id
  if (id === 'window' && (form.from == null || form.to == null)) setQuick('last24')
}

function setQuick (id) {
  form.quick = id
  const w = quick_window(id)
  if (w) { form.from = w.from; form.to = w.to }
}

// The inputs show London wall-clock time; the form holds instants in
// ms, so an untouched window keeps its exact stored value.
const fromLocal = computed({
  get: () => form.from == null || Number.isNaN(form.from) ? '' : ms_to_london_local(form.from),
  set: v => { form.from = v ? london_local_to_ms(v) : null; form.quick = 'custom' },
})
const toLocal = computed({
  get: () => form.to == null || Number.isNaN(form.to) ? '' : ms_to_london_local(form.to),
  set: v => { form.to = v ? london_local_to_ms(v) : null; form.quick = 'custom' },
})

const windowError = computed(() => window_problem(form, editShape.value))
const isoWindow = computed(() => windowError.value ? null : window_of(form, editShape.value))

/* ---------- Validation and plan ---------- */

const problemList = computed(() => problems(form, editShape.value))

const storeRows = computed(() => {
  if (editShape.value) return store_rows(form, ds.byUuid, { edit: editShape.value, record: record.value })
  if (!form.items.length || windowError.value) return store_rows(form, ds.byUuid)
  const steps = plan({ items: form.items.map(item_key), window: isoWindow.value })
  return store_rows(form, ds.byUuid, { steps })
})

/* ---------- Save ---------- */

function isUuid (s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

async function save () {
  touched.value = true
  if (problemList.value.length || saving.value) return
  saving.value = true
  saveError.value = null
  const client = useServiceClientStore().client
  try {
    // Make device datasets for picked devices that have none. Existing
    // ones are reused.
    const need = form.items.filter(i => i.type === 'device' && !i.dataset).map(i => i.uuid)
    let map = {}
    if (need.length) {
      try {
        map = await ensure_device_datasets(client, need, ds.byUuid, u => ds.deviceByUuid[u]?.name ?? null)
      }
      catch (err) {
        if (err instanceof DatasetError) throw err
        throw new DatasetError('Not saved. Nothing was saved and your changes are still here.',
          { status: err?.status, detail: err?.status === 403 ? 'You do not have permission for this.' : err?.message })
      }
    }

    const spec = {
      name: form.name.trim(),
      description: form.description,
      kind: form.kind,
      items: item_datasets(form.items, map, ds.byUuid),
      // ISO strings, not ms: validate_window in model.js parses strings.
      window: window_of(form, editShape.value),
      tags: form.tags,
      labels: form.kind === 'equipment' ? labels_by_dataset(form.items, map, ds.byUuid) : {},
      createdBy: useServiceClientStore().username ?? null,
    }

    if (mode.value === 'edit') {
      await update_from_spec(client, record.value, spec, ds.byUuid)
      toast.success('Changes saved')
      router.push(`/datasets/${record.value.uuid}`)
    }
    else {
      const uuid = await create_from_spec(client, spec)
      toast.success('Dataset created')
      router.push(`/datasets/${uuid}`)
    }
  }
  catch (err) {
    saveError.value = err instanceof DatasetError
      ? err
      : new DatasetError('Not saved. Nothing was saved and your changes are still here.', { detail: err?.message })
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }
  finally {
    saving.value = false
  }
}

function cancel () {
  if (window.history.state?.back) router.back()
  else router.push(record.value ? `/datasets/${record.value.uuid}` : '/datasets')
}
</script>
