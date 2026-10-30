<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Release: where the dataset's release outside Factory+ stands, the
     terms it is released under, and every briefcase built from it,
     each with a download to pass it on. Releasing and withdrawing are
     here too. -->
<template>
  <div class="flex flex-col gap-4">
    <Card class="flex flex-col gap-2 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="font-semibold">Release</span>
          <span :class="['rounded px-2 py-0.5 text-xs font-medium', STATES[state].pill]">{{ STATES[state].label }}</span>
        </div>
        <Button v-if="published" size="sm" variant="outline" @click="withdrawDialog?.open(record, live?.uuid)">
          <i class="fa-solid fa-ban mr-2"></i>Withdraw
        </Button>
        <Button v-else size="sm" :disabled="!!blocker" :title="blocker ?? ''" @click="releaseDialog?.open(record)">
          <i class="fa-solid fa-paper-plane mr-2"></i>Release
        </Button>
      </div>
      <p class="text-sm text-slate-600">{{ stateText }}</p>
      <p v-if="!published && blocker" class="text-xs text-slate-500">To release it: {{ blocker }}</p>
    </Card>

    <Card class="flex flex-col gap-3 p-4">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold">Release policy</span>
        <Button size="sm" variant="outline" @click="policyDialog?.open(record)">
          <i class="fa-solid fa-pen mr-2"></i>{{ policy ? 'Edit' : 'Add a policy' }}
        </Button>
      </div>
      <p v-if="!policy" class="text-sm text-slate-500">
        This dataset has no release policy. The exporter can't build a briefcase until it has one.
      </p>
      <dl v-else class="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-[max-content_minmax(0,1fr)]">
        <dt class="text-slate-500">Who may have it</dt>
        <dd>{{ TIERS[policy.tier] ?? policy.tier }}</dd>
        <dt class="text-slate-500">Data owner</dt>
        <dd>
          {{ policy.data_owner?.organisation }}
          <span v-if="policy.data_owner?.contact" class="text-slate-500">
            ({{ policy.data_owner.contact.name }}, {{ policy.data_owner.contact.email }})
          </span>
        </dd>
        <dt class="text-slate-500">Terms</dt>
        <dd>{{ policy.terms?.licence ? `Licence ${policy.terms.licence}` : `Data sharing agreement ${policy.terms?.agreement}` }}</dd>
        <dt class="text-slate-500">Permitted use</dt>
        <dd>{{ policy.permitted_use }}</dd>
        <template v-if="policy.trial">
          <dt class="text-slate-500">Trial</dt>
          <dd>{{ policy.trial }}</dd>
        </template>
        <template v-if="policy.embargo_until">
          <dt class="text-slate-500">Embargo until</dt>
          <dd>{{ policy.embargo_until }}</dd>
        </template>
        <template v-if="policy.review_by">
          <dt class="text-slate-500">Review by</dt>
          <dd>{{ policy.review_by }}</dd>
        </template>
      </dl>
    </Card>

    <Card class="flex flex-col gap-3 p-4">
      <span class="font-semibold">Briefcases <span class="font-normal text-slate-500">{{ history.length }}</span></span>
      <div v-if="entry === undefined" class="py-4 text-center text-sm text-slate-500">
        <i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading
      </div>
      <div v-else-if="!history.length" class="py-4 text-center text-sm text-slate-500">
        No briefcases to show.
      </div>
      <div v-else class="flex flex-col">
        <div v-for="b in history" :key="b.uuid"
             class="grid grid-cols-1 items-center gap-x-3 gap-y-1 border-b border-slate-100 px-2 py-2 text-sm md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto]">
          <span class="truncate font-mono text-xs" :title="b.uuid">
            {{ b.uuid }}
            <span v-if="b.replaces" class="block font-sans text-slate-500" :title="b.replaces">
              Replaces {{ b.replaces.slice(0, 8) }}
            </span>
          </span>
          <span class="text-slate-700">
            Built {{ fmt_time(b.built) }}
            <span class="block text-xs text-slate-500">{{ fmt_size(b.size) }}, SHA-256 {{ b.sha256.slice(0, 12) }}…</span>
          </span>
          <span>
            <span v-if="b.live" class="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Live</span>
            <span v-else-if="b.withdrawn" class="text-xs text-slate-500">Withdrawn {{ fmt_time(b.withdrawn) }}</span>
            <span v-if="b.note" class="block text-xs text-slate-600" :title="b.note.by ? `By ${b.note.by}` : ''">
              {{ b.note.reason }}
            </span>
          </span>
          <Button size="sm" variant="outline" :disabled="downloading === b.uuid" @click="download(b)">
            <i :class="['fa-solid mr-2', downloading === b.uuid ? 'fa-circle-notch animate-spin' : 'fa-download']"></i>Download
          </Button>
        </div>
      </div>
    </Card>

    <ReleasePolicyDialog ref="policyDialog"/>
    <ReleaseDialog ref="releaseDialog"/>
    <WithdrawDialog ref="withdrawDialog"/>
  </div>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { toast } from 'vue-sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { useFileDownload } from '@/composables/useFileDownload.js'
import { BRIEFCASE } from '@/lib/datasets/constants.js'
import { fmt_time } from '@/lib/datasets/model.js'
import {
  TIERS, is_published, release_policy, release_state, release_blocker,
  briefcase_history, briefcase_file_name, fmt_size,
} from '@/lib/datasets/release.js'
import ReleasePolicyDialog from './ReleasePolicyDialog.vue'
import ReleaseDialog from './ReleaseDialog.vue'
import WithdrawDialog from './WithdrawDialog.vue'

const props = defineProps({ record: { type: Object, required: true } })

const sc = useServiceClientStore()

const STATES = {
  released:    { label: 'Released',     pill: 'bg-green-100 text-green-800' },
  building:    { label: 'Building',     pill: 'bg-amber-100 text-amber-800' },
  withdrawing: { label: 'Withdrawing',  pill: 'bg-amber-100 text-amber-800' },
  withdrawn:   { label: 'Withdrawn',    pill: 'bg-slate-100 text-slate-700' },
  unreleased:  { label: 'Not released', pill: 'bg-slate-100 text-slate-700' },
}

const policyDialog = ref(null)
const releaseDialog = ref(null)
const withdrawDialog = ref(null)

/* The dataset's Briefcase release and Briefcase notes entries:
 * undefined while loading, null when there is none or this account
 * can't read it. */
const entry = ref(undefined)
const notes = ref(undefined)
let subs = []

watch(() => props.record.uuid, async uuid => {
  subs.forEach(s => s.unsubscribe())
  subs = []
  entry.value = undefined
  notes.value = undefined
  await serviceClientReady()
  // Another dataset may have opened while we waited.
  if (uuid !== props.record.uuid) return
  const follow = (app, into) => sc.client.ConfigDB.watch_config(app, uuid).subscribe({
    next: e => { into.value = e ?? null },
    error: err => {
      console.error('Watching briefcase entries failed', err)
      into.value = null
    },
  })
  subs = [follow(BRIEFCASE.App.Release, entry), follow(BRIEFCASE.App.Notes, notes)]
}, { immediate: true })
onUnmounted(() => subs.forEach(s => s.unsubscribe()))

const policy = computed(() => release_policy(props.record))
const published = computed(() => is_published(props.record))
const blocker = computed(() => release_blocker(props.record))
const state = computed(() => release_state(props.record, entry.value))
const history = computed(() => briefcase_history(entry.value, notes.value))
const live = computed(() => history.value.find(b => b.live) ?? null)

const stateText = computed(() => ({
  released:    'This dataset is in Published and its briefcase is live. Download it below to pass it on.',
  building:    policy.value
    ? 'This dataset is in Published. The exporter is building its briefcase, which takes a few minutes.'
    : "This dataset is in Published, but it has no release policy, so the exporter can't build a briefcase.",
  withdrawing: 'This dataset has left Published. The exporter is marking its briefcase withdrawn.',
  withdrawn:   'Every briefcase of this dataset has been withdrawn. Remove any copies passed on outside Factory+.',
  unreleased:  'This dataset is not in Published, so it has no briefcase.',
})[state.value])

const downloading = ref(null)

async function download (b) {
  downloading.value = b.uuid
  try {
    await useFileDownload(sc.client, briefcase_file_name(b), b.file)
  }
  catch (err) {
    console.error('Briefcase download failed', err)
    toast.error('Download failed', {
      description: err?.status === 403
        ? 'You do not have permission to download briefcases.'
        : (err?.message ?? 'The Files service refused the download.'),
    })
  }
  finally {
    downloading.value = null
  }
}
</script>
