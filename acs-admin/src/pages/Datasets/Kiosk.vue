<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The operator kiosk, full screen on a tablet next to the equipment.
     The URL #/kiosk/<equipment> comes from a QR code on the equipment.

     The recording lives on the server (a Recording entry on the
     equipment), so the screen follows the store's live state: a reload
     or a second tablet shows the same thing. Two things live on the
     tablet: a Stop pressed while offline, and the last save's summary. -->
<template>
  <div class="fixed inset-0 z-30 flex flex-col bg-white text-base text-slate-950">
    <!-- Top bar -->
    <header class="flex h-[72px] shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6">
      <div class="flex min-w-0 items-center gap-3">
        <button type="button" title="Exit to Datasets" aria-label="Exit to Datasets"
                class="-ml-2 shrink-0 rounded-md p-2 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                @click="router.push('/datasets')">
          <img src="/favicon.svg" alt="ACS" class="block w-7">
        </button>
        <div v-if="!eq" class="truncate text-xl font-bold tracking-tight">Choose equipment</div>
        <div v-else class="min-w-0">
          <div class="truncate text-xl font-bold leading-[26px] tracking-tight" :title="eqName">{{ eqName }}</div>
          <div class="truncate text-[13px] leading-4 text-gray-500">{{ eqWhere }}</div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-3">
        <button type="button"
                class="flex h-[52px] items-center gap-2 rounded-md px-3 text-[15px] text-gray-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
                :title="operator ? 'Change who is recording' : 'Add your name'"
                @click="operatorDialog = true">
          <i class="fa-solid fa-user"></i>
          <span class="max-w-[200px] truncate">{{ operator || 'Add your name' }}</span>
        </button>
        <Button v-if="eqUuid" variant="outline" class="h-[52px] gap-2 px-5 text-base" @click="router.push('/kiosk')">
          <i class="fa-solid fa-qrcode"></i>Change equipment
        </Button>
      </div>
    </header>

    <!-- Offline banner -->
    <div v-if="offline" role="status"
         class="flex shrink-0 items-center gap-2.5 border-b border-amber-200 bg-amber-50 px-6 py-3 text-[15px] text-amber-800">
      <i class="fa-solid fa-wifi"></i>
      <span><b>Connection lost.</b> A recording that has started keeps going on the server.</span>
    </div>

    <!-- Choose equipment -->
    <KioskChoose v-if="!eqUuid" :now="now" @choose="u => router.push(`/kiosk/${u}`)"/>

    <div v-else-if="ds.ready && !eq" class="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div class="text-2xl font-semibold">Equipment not found</div>
      <p class="max-w-md text-gray-500">It may have been deleted, or this account cannot see it.</p>
      <Button class="h-14 px-8 text-base" @click="router.push('/kiosk')">Choose equipment</Button>
    </div>

    <div v-else-if="!eq" class="flex flex-1 items-center justify-center gap-3 text-slate-500">
      <i class="fa-solid fa-circle-notch animate-spin"></i> Loading
    </div>

    <template v-else>
      <div class="shrink-0 px-6 pt-5">
        <KioskLane :runs="runs" :recording="recording" :saved-run="savedNow?.run ?? null" :now="now"/>
      </div>

      <!-- Ready -->
      <section v-if="phase === 'ready'" :class="PANEL">
        <div>
          <h1 class="text-[30px] font-semibold leading-9 tracking-tight">Ready to record</h1>
          <p class="mt-0.5 text-gray-500">{{ devices.text }}</p>
          <p v-if="devices.offline.length" class="mt-1 text-[15px] text-amber-700">
            <i class="fa-solid fa-circle-exclamation mr-1"></i>{{ offlineText }}. You can still record.
          </p>
        </div>
        <KioskOperatorField v-if="!operator" v-model="operatorDraft" :recent="operators"/>
        <div class="grid gap-4 md:grid-cols-2">
          <KioskTags :tags="draftTags" :suggestions="suggestions(draftTags)" optional placeholder="For example a job number"
                     @update="t => draftTags = t"/>
          <div class="flex flex-col gap-2">
            <label for="kiosk-note" class="text-[15px] font-medium">Note <span class="font-normal text-gray-400">optional</span></label>
            <input id="kiosk-note" v-model="draftNote" type="text" placeholder="For example new insert fitted" :class="FIELD"/>
          </div>
        </div>
        <button type="button" :class="BIG_START" :disabled="busy || !(operator || operatorDraft.trim())" @click="start()">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin text-2xl"></i>
          <i v-else class="fa-solid fa-circle text-xl text-red-400"></i>Start recording
        </button>
        <p v-if="!operator && !operatorDraft.trim()" class="-mt-3 text-center text-sm text-gray-500">Enter your name to start.</p>
      </section>

      <!-- Recording -->
      <section v-else-if="phase === 'recording'" :class="PANEL">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div class="flex items-center gap-2.5 whitespace-nowrap text-lg font-semibold text-green-600">
              <span class="h-3 w-3 rounded-full bg-green-500 motion-safe:animate-pulse"></span>Recording
              <span v-if="refLabel" class="font-medium text-slate-700">· {{ refLabel }} reference window</span>
            </div>
            <div class="mt-2 text-[96px] font-semibold leading-none tracking-tight tabular-nums">{{ fmt_elapsed(now - startedAt) }}</div>
          </div>
          <div class="text-right text-[15px] leading-[22px] text-gray-700">
            <div>{{ run_name(eqName, startedAt, recording.reference) }}</div>
            <div class="text-gray-500">Started {{ fmt_clock(startedAt, true) }}<template v-if="recording.operator"> by {{ recording.operator }}</template></div>
            <div class="text-gray-500">{{ devices.text }}</div>
          </div>
        </div>
        <p v-if="devices.offline.length" class="text-[15px] text-amber-700">
          <i class="fa-solid fa-circle-exclamation mr-1"></i>{{ offlineText }}
        </p>
        <div class="grid gap-4 md:grid-cols-2">
          <KioskTags id="kiosk-rec-tags" :tags="recording.tags ?? []" :suggestions="suggestions(recording.tags ?? [])"
                     :disabled="busy" @update="saveRecTags"/>
          <div class="flex flex-col gap-2">
            <label for="kiosk-rec-note" class="text-[15px] font-medium">Note</label>
            <input id="kiosk-rec-note" v-model="recNote" type="text" placeholder="For example new insert fitted" :class="FIELD"
                   enterkeyhint="done" @focus="noteFocused = true" @blur="saveRecNote" @keydown.enter.prevent="e => e.target.blur()"/>
          </div>
        </div>
        <button type="button" :class="BIG_STOP" :disabled="saving" @click="stop">
          <i class="fa-solid fa-stop"></i>{{ recording.reference ? 'Stop reference' : 'Stop recording' }}
        </button>
      </section>

      <!-- Saving -->
      <section v-else-if="phase === 'saving'" class="flex flex-1 flex-col items-center justify-center gap-4" role="status">
        <i class="fa-solid fa-circle-notch animate-spin text-[40px] text-slate-500"></i>
        <div class="text-[26px] font-semibold">Saving recording</div>
        <div v-if="savingAt" class="text-gray-500">Stopped at {{ fmt_clock(savingAt, true) }}</div>
      </section>

      <!-- Waiting to save (offline) -->
      <section v-else-if="phase === 'queued'" :class="PANEL">
        <div class="flex items-center gap-3.5">
          <span :class="MARK" class="bg-amber-500"><i class="fa-solid fa-clock"></i></span>
          <div>
            <h1 class="text-[30px] font-semibold leading-[34px] tracking-tight">Stopped at {{ fmt_clock(pending.stoppedAt, true) }}, waiting to save</h1>
            <p class="text-[15px] text-gray-500">This tablet keeps the stop time and sends it when the connection returns. The recording is safe on the server.</p>
          </div>
        </div>
        <Button variant="outline" class="h-[72px] gap-2 text-xl" @click="tryPending(true)">
          <i class="fa-solid fa-rotate"></i>Try now
        </Button>
      </section>

      <!-- Failed -->
      <section v-else-if="phase === 'failed'" :class="PANEL">
        <div class="flex items-center gap-3.5">
          <span :class="MARK" class="bg-red-500"><i class="fa-solid fa-exclamation"></i></span>
          <div>
            <h1 class="text-[30px] font-semibold leading-[34px] tracking-tight">The dataset was not saved</h1>
            <p class="text-[15px] text-gray-500">The recording is safe on the server. Try again, or leave it for an admin.</p>
            <p v-if="failedDetail" class="mt-1 text-sm text-red-600">{{ failedDetail }}</p>
          </div>
        </div>
        <div class="grid grid-cols-[2fr_1fr] gap-4">
          <button type="button" :class="BIG_PRIMARY" class="h-24 text-[26px]" :disabled="saving" @click="retry">
            <i class="fa-solid fa-rotate"></i>Try again
          </button>
          <Button variant="outline" class="h-24 whitespace-normal rounded-lg text-lg" @click="leaveForAdmin">Leave it for an admin</Button>
        </div>
      </section>

      <!-- Saved -->
      <section v-else-if="phase === 'saved'" :class="PANEL">
        <div class="flex items-center gap-3.5">
          <span :class="MARK" class="bg-green-600"><i class="fa-solid fa-check"></i></span>
          <div>
            <h1 class="text-[30px] font-semibold leading-[34px] tracking-tight">Recording saved</h1>
            <p class="text-[15px] text-gray-500">Stored as a dataset at {{ fmt_clock(savedNow.savedAt) }}. You can leave this screen.</p>
          </div>
        </div>
        <div v-if="savedNow.problems?.length" class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-800">
          Saved, but these details were not: {{ savedNow.problems.join('; ') }}. An admin can add them on the dataset page.
        </div>
        <div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div class="min-w-0 truncate text-xl font-semibold tracking-tight" :title="savedNow.name">{{ savedNow.name }}</div>
            <Button variant="outline" class="h-12 shrink-0 gap-2 px-4 text-base" @click="router.push(`/datasets/${savedNow.run}`)">
              View dataset<i class="fa-solid fa-arrow-right text-[13px]"></i>
            </Button>
          </div>
          <div class="grid grid-cols-3">
            <div v-for="(c, i) in savedCells" :key="c.label" class="px-5 py-4" :class="i < 2 ? 'border-r border-slate-200' : ''">
              <div class="text-[13px] text-gray-500">{{ c.label }}</div>
              <div class="mt-px text-[30px] font-semibold leading-[34px] tracking-tight tabular-nums">{{ c.value }}</div>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-5 py-3 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <span v-for="t in savedNow.tags ?? []" :key="t" class="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[13px]">
                <i class="fa-solid fa-tag text-[10px] text-gray-500"></i>{{ t }}
              </span>
            </div>
            <span class="whitespace-nowrap text-gray-700">{{ savedNow.devices }} {{ savedNow.devices === 1 ? 'device' : 'devices' }}</span>
          </div>
        </div>
        <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <button type="button" :class="BIG_PRIMARY" class="h-24 text-[26px]" :disabled="busy" @click="startNext">
            <i class="fa-solid fa-circle text-base text-red-400"></i>Start recording
          </button>
          <Button variant="outline" class="h-24 flex-col gap-0.5 whitespace-normal rounded-lg" :disabled="!resumeMs || busy" @click="resume">
            <span class="text-lg font-semibold"><i class="fa-solid fa-rotate-left mr-1 text-[15px]"></i>Resume recording</span>
            <span class="text-[13px] font-normal text-gray-500">{{ resumeText }}</span>
          </Button>
        </div>
      </section>

      <!-- Footer -->
      <footer class="flex min-h-16 shrink-0 flex-wrap items-center justify-center gap-2 border-t border-slate-200 px-4 py-1.5">
        <template v-if="phase === 'recording'">
          <Button variant="ghost" class="h-[52px] gap-2 px-5 text-base" @click="openDialog('correct')">
            <i class="fa-solid fa-clock-rotate-left"></i>Correct start time
          </Button>
          <Button variant="ghost" class="h-[52px] gap-2 px-5 text-base" @click="openDialog('void')">
            <i class="fa-solid fa-ban"></i>Void this recording
          </Button>
        </template>
        <template v-else-if="phase === 'ready' || phase === 'saved'">
          <Button variant="ghost" class="h-[52px] gap-2 px-5 text-base" @click="openForgot(null)">
            <i class="fa-solid fa-clock-rotate-left"></i>Add a recording I forgot to start
          </Button>
          <Button variant="ghost" class="h-[52px] gap-2 px-5 text-base" @click="openDialog('reference')">
            <i class="fa-solid fa-ruler-horizontal"></i>Record a reference window
          </Button>
        </template>
      </footer>
    </template>

    <!-- Dialogs -->
    <KioskOperatorDialog :open="operatorDialog" :current="operator" :recent="operators"
                         @close="operatorDialog = false; afterOperator = null" @save="setOperator"/>
    <KioskForgotDialog v-if="eq" :open="dialog === 'forgot'" :equipment-name="eqName" :runs="runs" :reference="forgotRef"
                       :now="now" :busy="busy" :error="dialogError" @close="closeDialog" @save="addPast"/>
    <KioskCorrectDialog v-if="recording" :open="dialog === 'correct'" :started-at="startedAt" :now="now"
                        :busy="busy" :error="dialogError" @close="closeDialog" @save="correctStart"/>
    <KioskVoidDialog :open="dialog === 'void'" :busy="busy" :error="dialogError" @close="closeDialog" @confirm="voidRecording"/>
    <KioskReferenceDialog :open="dialog === 'reference'" :busy="busy" :offline="offline" :error="dialogError"
                          @close="closeDialog" @start="startReference" @already="openForgot"/>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { useLayoutStore } from '@store/layoutStore.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { REFERENCE_TYPES } from '@/lib/datasets/constants.js'
import { display_name, fmt_clock, fmt_duration, fmt_elapsed, normalise_tags, to_iso } from '@/lib/datasets/model.js'
import {
  start_recording, update_recording, stop_recording, discard_recording, resume_run, add_past_run, run_name,
} from '@/lib/datasets/api.js'
import {
  derive_phase, saved_is_current, resume_left, fmt_minutes_left, is_network_error,
  read_pending, write_pending, clear_pending, read_saved, write_saved,
  read_operator, write_operator, read_operators, write_operators, remember_name,
  device_summary, main_area, suggest_tags,
} from '@/lib/datasets/kiosk.js'
import KioskChoose from '@components/Datasets/kiosk/KioskChoose.vue'
import KioskLane from '@components/Datasets/kiosk/KioskLane.vue'
import KioskTags from '@components/Datasets/kiosk/KioskTags.vue'
import KioskOperatorField from '@components/Datasets/kiosk/KioskOperatorField.vue'
import KioskOperatorDialog from '@components/Datasets/kiosk/KioskOperatorDialog.vue'
import KioskForgotDialog from '@components/Datasets/kiosk/KioskForgotDialog.vue'
import KioskCorrectDialog from '@components/Datasets/kiosk/KioskCorrectDialog.vue'
import KioskVoidDialog from '@components/Datasets/kiosk/KioskVoidDialog.vue'
import KioskReferenceDialog from '@components/Datasets/kiosk/KioskReferenceDialog.vue'

const PANEL = 'mx-auto grid w-full max-w-[920px] flex-1 auto-rows-max content-center gap-6 overflow-auto px-6 py-6 md:px-16'
const FIELD = 'h-14 w-full rounded-md border border-slate-200 bg-white px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2'
const BIG = 'inline-flex items-center justify-center gap-4 rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:opacity-50'
const BIG_PRIMARY = `${BIG} bg-slate-900 text-slate-50 hover:bg-slate-900/90`
const BIG_START = `${BIG_PRIMARY} h-[120px] text-[32px]`
const BIG_STOP = `${BIG} h-[120px] bg-red-500 text-[32px] text-slate-50 hover:bg-red-500/90`
const MARK = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-white'

const route = useRoute()
const router = useRouter()
const ds = useDatasetsStore()
const layout = useLayoutStore()
const sc = useServiceClientStore()

// localStorage can throw in a private window or with blocked site data.
const storage = (() => { try { return globalThis.localStorage ?? null } catch { return null } })()

/* ------------------------------------------------------------------
 * Clock and connection
 * ------------------------------------------------------------------ */

const now = ref(Date.now())
const online = ref(globalThis.navigator?.onLine ?? true)
// A write failed because the server could not be reached.
const netDown = ref(false)
const offline = computed(() => !online.value || netDown.value)

/* ------------------------------------------------------------------
 * Equipment and its state
 * ------------------------------------------------------------------ */

const eqUuid = computed(() => route.params.equipment || null)
const eq = computed(() => eqUuid.value ? ds.byUuid[eqUuid.value] ?? null : null)
const eqName = computed(() => display_name(eq.value))
const recording = computed(() => eq.value?.recording?.startedAt ? eq.value.recording : null)
const startedAt = computed(() => recording.value ? Date.parse(recording.value.startedAt) : 0)
const runs = computed(() => ds.runsByEquipment[eqUuid.value] ?? [])

const deviceUuids = computed(() => eqUuid.value ? ds.devicesOf(eqUuid.value).devices : [])
const deviceList = computed(() => deviceUuids.value.map(u => ds.deviceByUuid[u] ?? { uuid: u, name: u.slice(0, 8), status: null }))
const devices = computed(() => device_summary(deviceList.value, ds.statusReady))
const eqWhere = computed(() => {
  const n = deviceUuids.value.length
  return [main_area(deviceList.value), `${n} ${n === 1 ? 'device' : 'devices'}`].filter(Boolean).join(' · ')
})
const offlineText = computed(() => {
  const names = devices.value.offline
  if (names.length === 1) return `${names[0]} is offline`
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are offline`
})

const refLabel = computed(() => REFERENCE_TYPES.find(t => t.id === recording.value?.reference)?.label ?? null)

function suggestions (exclude) {
  return suggest_tags(runs.value, ds.allTags, exclude, 6)
}

/* ------------------------------------------------------------------
 * Operator (the tablet signs in as one account)
 * ------------------------------------------------------------------ */

const operator = ref(read_operator(storage))
const operators = ref(read_operators(storage))
const operatorDraft = ref('')
const operatorDialog = ref(false)
// Something to do once the operator has given a name.
const afterOperator = ref(null)

function setOperator (name) {
  operator.value = name
  operators.value = remember_name(operators.value, name)
  write_operator(storage, name)
  write_operators(storage, operators.value)
  operatorDialog.value = false
  const next = afterOperator.value
  afterOperator.value = null
  next?.()
}

/** Run `fn` now if there is an operator, or after one is given. */
function withOperator (fn) {
  if (!operator.value && operatorDraft.value.trim()) setOperator(operatorDraft.value.trim())
  if (operator.value) return fn()
  afterOperator.value = fn
  operatorDialog.value = true
}

/* ------------------------------------------------------------------
 * Local state: offline Stop, last save, this tablet's failure
 * ------------------------------------------------------------------ */

const pending = ref(null)
const saved = ref(null)
const dialog = ref(null)
const dialogError = ref(null)
const forgotRef = ref(null)
const saving = ref(false)
const savingAt = ref(null)
const failed = ref(false)
const failedDetail = ref(null)
const failedAt = ref(null)
const busy = ref(false)

const draftTags = ref([])
const draftNote = ref('')
const recNote = ref('')
const noteFocused = ref(false)

const savedNow = computed(() => saved.value && saved_is_current(saved.value, runs.value, now.value) ? saved.value : null)

const phase = computed(() => derive_phase({
  equipment: eq.value ? eqUuid.value : null,
  recording: recording.value,
  pending: pending.value,
  saved: savedNow.value,
  saving: saving.value,
  failed: failed.value,
}))

const resumeMs = computed(() => resume_left(savedNow.value, now.value))
const resumeText = computed(() => {
  if (savedNow.value?.added) return 'Not for recordings added afterwards'
  if (!resumeMs.value) return 'No longer available'
  return `If you stopped by mistake · ${fmt_minutes_left(resumeMs.value)}`
})
const savedCells = computed(() => savedNow.value ? [
  { label: 'Started', value: fmt_clock(savedNow.value.from, true) },
  { label: 'Stopped', value: fmt_clock(savedNow.value.to, true) },
  { label: 'Duration', value: fmt_duration(savedNow.value.to - savedNow.value.from) },
] : [])

function loadLocal () {
  const u = eqUuid.value
  pending.value = u ? read_pending(storage, u) : null
  saved.value = u ? read_saved(storage, u) : null
  failed.value = false
  failedDetail.value = null
  failedAt.value = null
  draftTags.value = []
  draftNote.value = ''
  dialog.value = null
}

function setSaved (value) {
  saved.value = value
  if (eqUuid.value) write_saved(storage, eqUuid.value, value)
}

// Keep the note field in step with the server, except while typing.
watch(() => recording.value?.note, v => { if (!noteFocused.value) recNote.value = v ?? '' }, { immediate: true })

// A pending stop for a recording that has gone (stopped or voided on
// another tablet) has nothing left to save.
// A kept Stop for a live recording is sent as soon as possible.
watch([recording, () => ds.ready], () => {
  if (!ds.ready || !eq.value || !pending.value || saving.value) return
  // Gone, or a different recording started since: nothing of ours to save.
  const ours = !pending.value.startedAt || recording.value?.startedAt === pending.value.startedAt
  if (!recording.value || !ours) {
    clear_pending(storage, eqUuid.value)
    pending.value = null
  }
  else if (online.value) tryPending()
})

watch(eqUuid, loadLocal, { immediate: true })

/* ------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------ */

const by = () => sc.username ?? null
const client = () => sc.client

/** Show a failed write. Returns true if it was a network failure. */
function report (err, what) {
  const net = is_network_error(err, online.value)
  if (net) netDown.value = true
  toast.error(net ? `${what} No connection.` : what, {
    description: net ? 'Try again when the connection is back.' : (err?.detail ?? err?.message),
  })
  return net
}

function wrote () { netDown.value = false }

function start ({ reference = null } = {}) {
  return withOperator(async () => {
    if (!online.value) {
      toast.error('Not connected', { description: 'Start needs the server so the recording is safe. Try again when the connection is back.' })
      return
    }
    busy.value = true
    try {
      await start_recording(client(), eq.value, {
        by: by(),
        operator: operator.value,
        tags: draftTags.value,
        note: draftNote.value,
        reference,
        devices: deviceUuids.value,
      })
      wrote()
      draftTags.value = []
      draftNote.value = ''
      setSaved(null)
      failed.value = false
      dialog.value = null
    }
    catch (err) { report(err, 'The recording did not start.') }
    finally { busy.value = false }
  })
}

function startNext () { start() }

function startReference (type) { start({ reference: type }) }

function stop () {
  const stoppedAt = Date.now()
  if (!online.value) {
    queueStop(stoppedAt)
    return
  }
  save(stoppedAt)
}

function queueStop (stoppedAt) {
  const p = { stoppedAt, by: by(), startedAt: recording.value?.startedAt ?? null }
  write_pending(storage, eqUuid.value, p)
  pending.value = p
}

/** Stop the recording and save the run, with the given stop time. */
async function save (stoppedAt, startedAt = null) {
  if (saving.value || !eq.value) return
  const rec = recording.value
  saving.value = true
  savingAt.value = stoppedAt
  failed.value = false
  failedDetail.value = null
  try {
    const res = await stop_recording(client(), eq.value, { stoppedAt, by: by(), startedAt })
    wrote()
    clear_pending(storage, eqUuid.value)
    pending.value = null
    setSaved({
      run: res.run,
      name: res.name,
      from: res.from,
      to: res.to,
      problems: res.problems ?? [],
      savedAt: Date.now(),
      recordStart: rec?.startedAt ?? null,
      tags: rec?.tags ?? [],
      note: rec?.note ?? null,
      operator: rec?.operator ?? null,
      reference: rec?.reference ?? null,
      deviceList: rec?.devices ?? [],
      devices: (rec?.devices ?? []).length,
    })
  }
  catch (err) {
    if (is_network_error(err, online.value)) {
      netDown.value = true
      queueStop(stoppedAt)
    }
    else if (err?.status === 409 || err?.status === 404) {
      // Stopped elsewhere, or another recording has started: drop ours.
      clear_pending(storage, eqUuid.value)
      pending.value = null
      toast.info(err.message)
    }
    else {
      failed.value = true
      failedAt.value = stoppedAt
      failedDetail.value = err?.detail ?? null
      clear_pending(storage, eqUuid.value)
      pending.value = null
    }
  }
  finally {
    saving.value = false
  }
}

function retry () {
  const at = recording.value?.stoppedAt ? Date.parse(recording.value.stoppedAt) : failedAt.value ?? Date.now()
  save(at)
}

/** Send a Stop kept while offline. `manual` when the operator asks. */
async function tryPending (manual = false) {
  if (!pending.value || saving.value || !recording.value) return
  await save(pending.value.stoppedAt, pending.value.startedAt ?? null)
  if (manual && pending.value) {
    toast.info('Still not connected', { description: 'The stop time is kept. It is sent when the connection returns.' })
  }
}

function leaveForAdmin () {
  failed.value = false
  router.push('/kiosk')
}

async function resume () {
  const s = savedNow.value
  if (!s || !resumeMs.value) return
  busy.value = true
  try {
    await resume_run(client(), eq.value, { uuid: s.run, from: to_iso(s.from) }, {
      by: by(),
      operator: s.operator ?? operator.value,
      tags: s.tags,
      note: s.note,
      devices: s.deviceList?.length ? s.deviceList : deviceUuids.value,
      reference: s.reference,
    })
    wrote()
    setSaved(null)
  }
  catch (err) { report(err, 'The recording did not resume.') }
  finally { busy.value = false }
}

async function saveRecTags (tags) {
  busy.value = true
  try {
    await update_recording(client(), eqUuid.value, r => { r.tags = normalise_tags(tags); return r })
    wrote()
  }
  catch (err) { report(err, 'The tags were not saved.') }
  finally { busy.value = false }
}

async function saveRecNote () {
  noteFocused.value = false
  const next = recNote.value.trim()
  if (!recording.value || next === (recording.value.note ?? '')) return
  try {
    await update_recording(client(), eqUuid.value, r => { r.note = next || null; return r })
    wrote()
  }
  catch (err) { report(err, 'The note was not saved.') }
}

/* ------------------------------------------------------------------
 * Dialogs
 * ------------------------------------------------------------------ */

function openDialog (name) {
  dialogError.value = null
  dialog.value = name
}

function closeDialog () {
  if (busy.value) return
  dialog.value = null
}

function openForgot (reference) {
  forgotRef.value = reference ?? null
  openDialog('forgot')
}

/** Run a dialog's write; keep the dialog open with the error on failure. */
async function dialogWrite (fn, failText) {
  busy.value = true
  dialogError.value = null
  try {
    await fn()
    wrote()
    dialog.value = null
  }
  catch (err) {
    const net = is_network_error(err, online.value)
    if (net) netDown.value = true
    dialogError.value = net ? `${failText} No connection.` : `${failText} ${err?.detail ?? err?.message ?? ''}`.trim()
  }
  finally { busy.value = false }
}

function addPast ({ from, to, reason }) {
  return withOperator(() => dialogWrite(async () => {
    const reference = forgotRef.value
    const run = await add_past_run(client(), eq.value, {
      from: to_iso(from), to: to_iso(to),
      by: by(), operator: operator.value,
      tags: draftTags.value, note: reason, reference,
    })
    setSaved({
      run, name: run_name(eqName.value, from, reference), from, to, problems: [],
      savedAt: Date.now(), added: true, recordStart: null,
      tags: normalise_tags(draftTags.value), devices: deviceUuids.value.length, reference,
    })
    draftTags.value = []
  }, 'Not saved.'))
}

function correctStart (ms) {
  if (ms > Date.now()) { dialogError.value = 'The start cannot be in the future.'; return }
  return dialogWrite(() => update_recording(client(), eqUuid.value, r => { r.startedAt = to_iso(ms); return r }),
    'The start time was not changed.')
}

function voidRecording () {
  return dialogWrite(async () => {
    await discard_recording(client(), eqUuid.value)
    toast.success('Recording voided', { description: 'No dataset was saved.' })
  }, 'The recording was not voided.')
}

/* ------------------------------------------------------------------
 * Lifecycle
 * ------------------------------------------------------------------ */

let tick = null
let flush = null

function onOnline () {
  online.value = true
  netDown.value = false
  tryPending()
}
function onOffline () { online.value = false }

let wasFullscreen = false
onMounted(() => {
  wasFullscreen = layout.fullscreen
  layout.toggleFullscreen(true)
  ds.start()
  tick = setInterval(() => { now.value = Date.now() }, 1000)
  // Retry a kept Stop now and then, in case no online event fires.
  flush = setInterval(() => { if (pending.value && online.value) tryPending() }, 15 * 1000)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
})

onUnmounted(() => {
  clearInterval(tick)
  clearInterval(flush)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  layout.toggleFullscreen(wasFullscreen)
  ds.stop()
})
</script>
