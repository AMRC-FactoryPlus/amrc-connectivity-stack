<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Share: grant "Read dataset" on this dataset to a principal, and
     "Use for session" when ticked. Making a session dataset also needs
     "Create dataset" on the Session structure, so once someone is picked
     the card checks for it and offers it. Only administrators can add
     grants today, so there is no permission check first: it tries, and a
     refusal says so. -->
<template>
  <Card class="flex flex-col gap-3 p-5">
    <div class="font-semibold"><i class="fa-solid fa-user-plus mr-2 text-slate-500"></i>Share</div>
    <p class="text-sm text-slate-600">
      Let another account read this dataset, through the CSV download or the API.
      Tick Use for sessions to let them make session datasets from it too.
    </p>

    <div class="flex flex-wrap items-start gap-2">
      <div class="relative w-full max-w-md">
        <input v-model="query" placeholder="Search accounts by name or username" aria-label="Account to share with"
               class="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
               @focus="open = true" @input="open = true" @blur="close"/>
        <div v-if="open && suggestions.length && !picked"
             class="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-md">
          <button v-for="p in suggestions" :key="p.uuid" type="button"
                  class="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                  @mousedown.prevent="pick(p)">
            <span class="font-medium">{{ label(p) }}</span>
            <span class="text-xs text-slate-500">{{ p.kerberos ?? p.uuid }}</span>
          </button>
        </div>
      </div>
      <Button :disabled="!picked || busy" @click="share">
        <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>Share
      </Button>
    </div>
    <label class="flex w-fit cursor-pointer items-center gap-2 text-sm">
      <input v-model="session" type="checkbox" class="accent-slate-900">
      Use for sessions
    </label>
    <div v-if="picked && session" class="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <template v-if="sessionMaker === undefined">
        <i class="fa-solid fa-circle-notch animate-spin text-slate-400"></i>
        Checking whether {{ label(picked) }} can make session datasets
      </template>
      <template v-else-if="sessionMaker === true">
        <i class="fa-solid fa-check text-slate-500"></i>
        {{ label(picked) }} can make session datasets.
      </template>
      <template v-else-if="sessionMaker === false">
        <i class="fa-solid fa-circle-info text-slate-500"></i>
        {{ label(picked) }} can't make session datasets yet.
        <Button size="sm" variant="outline" :disabled="busy" @click="allowSessions">
          Let them make session datasets
        </Button>
      </template>
      <template v-else>
        <i class="fa-solid fa-circle-info text-slate-500"></i>
        You can't check whether {{ label(picked) }} can make session datasets.
      </template>
    </div>
    <div v-if="principals.loading && !principals.data.length" class="text-xs text-slate-500">
      <i class="fa-solid fa-circle-notch animate-spin mr-1"></i>Loading accounts
    </div>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <div v-if="lists.some(l => l.grants.length)" class="flex flex-wrap gap-x-8 gap-y-3">
      <div v-for="l in lists.filter(l => l.grants.length)" :key="l.id" class="flex flex-col gap-1">
        <div class="text-xs text-slate-500">{{ l.label }}</div>
        <div class="flex flex-wrap gap-1">
          <span v-for="g in l.grants" :key="g.uuid" class="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            <i class="fa-solid fa-user mr-1 text-slate-400"></i>{{ nameOf(g.principal) }}
          </span>
        </div>
      </div>
    </div>
  </Card>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { toast } from 'vue-sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import { useObjectStore } from '@store/useObjectStore.js'
import {
  share_grants, share_lists, load_share_grants, session_maker_grant, can_make_sessions,
} from './share-logic.js'

const props = defineProps({ record: { type: Object, required: true } })

const principals = usePrincipalStore()
const query = ref('')
const open = ref(false)
const picked = ref(null)
const busy = ref(false)
const error = ref(null)
const grants = ref([])
const session = ref(false)
// Whether the picked account can make session datasets: undefined while
// checking, then true, false, or null when their ACL cannot be read.
const sessionMaker = ref(undefined)
const lists = computed(() => share_lists(grants.value, props.record.uuid))

// The principal store's start is not idempotent, and for people who
// cannot list principals it retries, so stop it again if we started it.
let started = false
onMounted(async () => {
  await useObjectStore().start()
  if (!principals.rxsub) { started = true; principals.start() }
})
onUnmounted(() => { if (started) principals.stop() })

const label = p => p.name && p.name !== 'UNKNOWN' ? p.name : (p.kerberos ?? p.uuid)
const nameOf = uuid => {
  const p = principals.data.find(x => x.uuid === uuid)
  return p ? label(p) : uuid
}

const suggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return principals.data.slice(0, 8)
  return principals.data
    .filter(p => `${p.name} ${p.kerberos ?? ''} ${p.uuid}`.toLowerCase().includes(q))
    .slice(0, 8)
})

watch(query, q => { if (picked.value && q !== label(picked.value)) picked.value = null })

watch(picked, async p => {
  sessionMaker.value = undefined
  if (!p) return
  const ok = await can_make_sessions(useServiceClientStore().client.Auth, p.uuid)
  if (picked.value === p) sessionMaker.value = ok
})

function pick (p) {
  picked.value = p
  query.value = label(p)
  open.value = false
}

function close () { setTimeout(() => { open.value = false }, 100) }

function failed (err) {
  console.error('Share failed', err)
  error.value = err?.status === 403
    ? 'Only administrators can share datasets at the moment.'
    : `The share failed${err?.status ? ` (HTTP ${err.status})` : ''}.`
}

async function share () {
  busy.value = true
  error.value = null
  try {
    const auth = useServiceClientStore().client.Auth
    for (const g of share_grants({ principal: picked.value.uuid, dataset: props.record.uuid, session: session.value }))
      await auth.add_grant(g)
    toast.success(session.value
      ? `${label(picked.value)} can now read this dataset and use it for sessions`
      : `${label(picked.value)} can now read this dataset`)
    picked.value = null
    query.value = ''
  }
  catch (err) {
    failed(err)
  }
  finally {
    busy.value = false
    loadGrants()
  }
}

// Lets the picked account make session datasets, from any dataset they
// may use for sessions.
async function allowSessions () {
  busy.value = true
  error.value = null
  const p = picked.value
  try {
    await useServiceClientStore().client.Auth.add_grant(session_maker_grant(p.uuid))
    if (picked.value === p) sessionMaker.value = true
    toast.success(`${label(p)} can now make session datasets`)
  }
  catch (err) {
    failed(err)
  }
  finally {
    busy.value = false
  }
}

// Existing grants, when the Auth service lets you read them. Anyone
// else sees no list, which is fine.
async function loadGrants () {
  try {
    grants.value = await load_share_grants(useServiceClientStore().client.Auth, props.record.uuid)
  }
  catch {
    grants.value = []
  }
}

watch(() => props.record.uuid, loadGrants, { immediate: true })
</script>
