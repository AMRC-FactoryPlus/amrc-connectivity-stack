<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Share: grant "Read dataset" on this dataset to a principal. Only
     administrators can add grants today, so there is no permission
     check first: it tries, and a refusal says so. -->
<template>
  <Card class="flex flex-col gap-3 p-5">
    <div class="font-semibold"><i class="fa-solid fa-user-plus mr-2 text-slate-500"></i>Share</div>
    <p class="text-sm text-slate-600">
      Let another account read this dataset, through the CSV download or the API.
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
    <div v-if="principals.loading && !principals.data.length" class="text-xs text-slate-500">
      <i class="fa-solid fa-circle-notch animate-spin mr-1"></i>Loading accounts
    </div>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <div v-if="grants.length" class="flex flex-col gap-1">
      <div class="text-xs text-slate-500">Can read this dataset</div>
      <div class="flex flex-wrap gap-1">
        <span v-for="g in grants" :key="g.uuid" class="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          <i class="fa-solid fa-user mr-1 text-slate-400"></i>{{ nameOf(g.principal) }}
        </span>
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
import { READ_DATASET } from './page-logic.js'

const props = defineProps({ record: { type: Object, required: true } })

const principals = usePrincipalStore()
const query = ref('')
const open = ref(false)
const picked = ref(null)
const busy = ref(false)
const error = ref(null)
const grants = ref([])

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

function pick (p) {
  picked.value = p
  query.value = label(p)
  open.value = false
}

function close () { setTimeout(() => { open.value = false }, 100) }

async function share () {
  busy.value = true
  error.value = null
  try {
    await useServiceClientStore().client.Auth.add_grant({
      principal: picked.value.uuid,
      permission: READ_DATASET,
      target: props.record.uuid,
      plural: false,
    })
    toast.success(`${label(picked.value)} can now read this dataset`)
    picked.value = null
    query.value = ''
    loadGrants()
  }
  catch (err) {
    console.error('Share failed', err)
    error.value = err?.status === 403
      ? 'Only administrators can share datasets at the moment.'
      : `The share failed${err?.status ? ` (HTTP ${err.status})` : ''}.`
  }
  finally {
    busy.value = false
  }
}

// Existing grants, when the Auth service lets you read them. Anyone
// else sees no list, which is fine.
async function loadGrants () {
  try {
    const auth = useServiceClientStore().client.Auth
    const ids = await auth.find_grants({ permission: READ_DATASET, target: props.record.uuid })
    grants.value = (await Promise.all((ids ?? []).map(id => auth.get_grant(id).then(g => ({ ...g, uuid: id })).catch(() => null))))
      .filter(Boolean)
  }
  catch {
    grants.value = []
  }
}

watch(() => props.record.uuid, loadGrants, { immediate: true })
</script>
