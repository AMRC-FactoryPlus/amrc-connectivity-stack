<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Delete a dataset. The service refuses (HTTP 409) while other
     datasets include it; the dialog then lists them with links. A
     session over its own "<name> (devices)" union deletes that union
     too, session first. Opening the union itself offers to delete both,
     again session first. Call open(record) through a ref. Emits
     `deleted` with the UUID. -->
<template>
  <Dialog :open="!!target" @update:open="v => !v && close()">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ owner ? 'Delete dataset' : referrers ? 'This dataset is in use' : 'Delete dataset' }}</DialogTitle>
        <DialogDescription v-if="owner">
          "{{ name }}" is the device list of "{{ ownerName }}", and nothing else uses it.
          Delete "{{ ownerName }}" and this? The data stays in the historian, and this cannot be undone.
        </DialogDescription>
        <DialogDescription v-else-if="!referrers">
          Delete "{{ name }}"? The data stays in the historian. Only this dataset's definition goes, and this cannot be undone.
          <template v-if="plan.helper">This also deletes its device list, "{{ helperName }}", which nothing else uses.</template>
        </DialogDescription>
        <DialogDescription v-else>
          The service refused to delete "{{ name }}" because {{ referrers.length }}
          other {{ referrers.length === 1 ? 'dataset includes' : 'datasets include' }} it.
          Delete or change {{ referrers.length === 1 ? 'that one' : 'those' }} first.
        </DialogDescription>
      </DialogHeader>

      <ul v-if="referrers && !owner" class="max-h-64 overflow-y-auto rounded-md border border-slate-200 divide-y">
        <li v-for="r in referrers" :key="r" class="px-3 py-2 text-sm">
          <span v-if="gone.includes(r)">The dataset just deleted</span>
          <RouterLink v-else :to="`/datasets/${r}`" class="hover:underline" @click="close">
            {{ ds.byUuid[r] ? ds.name(r) : 'A dataset you cannot see' }}
          </RouterLink>
          <div class="text-xs text-slate-400 font-mono">{{ r }}</div>
        </li>
      </ul>

      <p v-if="waiting" class="text-sm text-slate-500">
        <i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Deleting the device list...
      </p>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close">{{ referrers && !owner ? 'Close' : 'Cancel' }}</Button>
        <Button v-if="owner" variant="destructive" :disabled="busy" @click="deleteWithOwner">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>
          Delete "{{ ownerName }}" and this
        </Button>
        <Button v-else-if="!referrers || allGone" variant="destructive" :disabled="busy" @click="confirm">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>
          {{ referrers ? 'Try again' : 'Delete' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { delete_plan, helper_owner, owner_of_helper, delete_in_order, dataset_exists } from '@/lib/datasets/api.js'
import { display_name } from '@/lib/datasets/model.js'

const emit = defineEmits(['deleted'])
const ds = useDatasetsStore()
const target = ref(null)
const referrers = ref(null)
const error = ref(null)
const busy = ref(false)
// Waiting for the service to see that a dataset has gone.
const waiting = ref(false)
// Referrers that no longer exist, so a refusal can name them.
const gone = ref([])
// The session whose device list the target is, kept as found so the
// offer stays while the store catches up with a delete.
const owner = ref(null)
const name = computed(() => display_name(target.value))
const ownerName = computed(() => display_name(owner.value))
// Every dataset that held this one back has been deleted since.
const allGone = computed(() => !!referrers.value?.length && referrers.value.every(r => gone.value.includes(r)))

// The dataset, then its own device list when it has one.
const plan = computed(() => target.value ? delete_plan(target.value, ds.byUuid) : { order: [], helper: null })
const helperName = computed(() => display_name(plan.value.helper))

// Bumped when the dialog closes or opens again, so a run still going
// cannot change what the dialog shows.
let runId = 0

function open (record) {
  runId++
  target.value = record
  referrers.value = null
  error.value = null
  busy.value = false
  waiting.value = false
  gone.value = []
  // A device list with its own session: offer both, session first. No
  // request goes to the service until the person chooses.
  owner.value = owner_of_helper(record, ds.byUuid)
}

function close () {
  runId++
  busy.value = false
  waiting.value = false
  target.value = null
}

const why = res => res.timedOut ? res.reason
  : res.referrers ? 'other datasets include it'
  : (res.reason ?? 'the service refused')

/* Delete in order. A refusal that names only datasets that no longer
 * exist is retried for a few seconds while the service catches up. */
async function run (order) {
  const my = ++runId
  const client = useServiceClientStore().client
  busy.value = true
  error.value = null
  try {
    const res = await delete_in_order(client, order, {
      onWait: () => { if (my === runId) waiting.value = true },
      gone: async r => gone.value.includes(r) || (!ds.byUuid[r] && !await dataset_exists(client, r)),
      cancelled: () => my !== runId,
    })
    if (my !== runId) return null
    gone.value = [...new Set([...gone.value, ...res.deleted, ...(res.gone ?? [])])]
    return res
  }
  catch (err) {
    if (my === runId) error.value = err?.message ?? 'The delete failed.'
    return null
  }
  finally {
    if (my === runId) {
      busy.value = false
      waiting.value = false
    }
  }
}

async function confirm () {
  const rec = target.value
  const helper = plan.value.helper
  const res = await run(plan.value.order)
  if (!res) return
  if (res.ok) {
    toast.success(helper ? 'Dataset and its device list deleted' : 'Dataset deleted')
    emit('deleted', rec.uuid)
    close()
  }
  else if (res.deleted.includes(rec.uuid)) {
    // The dataset went but its device list did not.
    toast.error('Device list not deleted', {
      description: `"${display_name(rec)}" is deleted. Its device list, "${display_name(helper)}", is not: ${why(res)}.`,
    })
    emit('deleted', rec.uuid)
    close()
  }
  else if (res.referrers) {
    referrers.value = res.referrers
    owner.value = helper_owner(rec, res.referrers, ds.byUuid)
  }
  else error.value = res.reason
}

async function deleteWithOwner () {
  const rec = target.value
  const first = owner.value
  if (!first) return
  const res = await run([first.uuid, rec.uuid])
  if (!res) return
  if (res.ok) {
    toast.success('Both datasets deleted')
    emit('deleted', rec.uuid)
    close()
  }
  else if (res.deleted.includes(first.uuid)) {
    owner.value = null
    error.value = `"${display_name(first)}" is deleted. "${display_name(rec)}" is not: ${why(res)}.`
    if (res.referrers) referrers.value = res.referrers
  }
  else error.value = `Nothing was deleted. "${display_name(first)}" could not be deleted: ${why(res)}.`
}

defineExpose({ open })
</script>
