<!--
  - ACS Admin
  - Sidebar panel: who can read a device or ISA-95 node through i3X, and
  - granting or removing that access for a user or group.
  - Copyright 2026 University of Sheffield AMRC
  -->

<!-- Only administrators can change grants today, so there is no
     permission check first: it tries, and a refusal says so. Grants the
     viewer may not read are not listed. -->
<template>
  <div class="flex items-center justify-between gap-2 p-4 border-b">
    <div class="font-semibold text-lg">i3X Read Access</div>
    <Button title="Refresh" size="sm" variant="ghost" :disabled="loading" @click="load">
      <i class="fa-solid fa-sync text-sm" :class="{ 'animate-spin': loading }"></i>
    </Button>
  </div>
  <div class="space-y-3 p-4">
    <p class="text-sm text-gray-500">
      Users and groups listed here can read this {{ noun }}<span v-if="!device"> and every device under it</span>
      through the i3X API.
    </p>

    <div class="relative">
      <input v-model="query" :placeholder="`Search users and groups`" aria-label="User or group to give read access"
             class="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
             @focus="open = true" @input="open = true" @blur="close"/>
      <div v-if="open && suggestions.length && !picked"
           class="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-md">
        <button v-for="p in suggestions" :key="p.uuid" type="button"
                class="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                @mousedown.prevent="pick(p)">
          <i class="fa-fw fa-solid mt-0.5 text-slate-400" :class="p.group ? 'fa-users' : 'fa-user'"></i>
          <span class="flex flex-col">
            <span class="font-medium">{{ p.label }}</span>
            <span class="text-xs text-slate-500">{{ p.group ? 'Group' : (p.kerberos ?? p.uuid) }}</span>
          </span>
        </button>
      </div>
    </div>
    <Button class="w-full" :disabled="!picked || busy" @click="add">
      <i class="fa-solid mr-2" :class="busy ? 'fa-circle-notch animate-spin' : 'fa-plus'"></i>
      Give read access
    </Button>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <div v-if="loading && !rows.length" class="text-xs text-slate-500">
      <i class="fa-solid fa-circle-notch animate-spin mr-1"></i>Loading access
    </div>
    <div v-else-if="!rows.length" class="text-sm text-slate-500">
      No grants you can see.
    </div>
    <ul v-else class="divide-y divide-slate-100 rounded-md border border-slate-200">
      <li v-for="r in rows" :key="`${r.reason}:${r.grant.uuid}`" class="flex items-center gap-2 px-3 py-2">
        <i class="fa-fw fa-solid text-slate-400" :class="isGroup(r.grant.principal) ? 'fa-users' : 'fa-user'"></i>
        <div class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm font-medium">{{ nameOf(r.grant.principal) }}</span>
          <span class="truncate text-xs text-slate-500">{{ reasonText(r) }}</span>
        </div>
        <Button v-if="r.reason === 'direct'" title="Remove read access" size="xs" variant="ghost"
                :disabled="busy" @click="remove(r.grant)">
          <i class="fa-solid fa-trash text-red-400"></i>
        </Button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { Button } from '@/components/ui/button'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import { useObjectStore } from '@store/useObjectStore.js'
import { READ_OBJECT, read_access } from '@/lib/access/i3x-access.js'

const props = defineProps({
  /* What to grant on: a device UUID or an ISA-95 node UUID. */
  target: { type: String, required: true },
  /* True for a device, false for an ISA-95 node. */
  device: { type: Boolean, default: false },
  /* ISA-95 nodes above the target, top first: { uuid, name, level }. */
  via: { type: Array, default: () => [] },
  /* What to call the target in the text, e.g. "device" or "site". */
  noun: { type: String, default: 'device' },
})

const principals = usePrincipalStore()
const objects = useObjectStore()
const groups = ref([])
const rows = ref([])
const loading = ref(false)
const query = ref('')
const open = ref(false)
const picked = ref(null)
const busy = ref(false)
const error = ref(null)

// The principal store's start is not idempotent, and for people who
// cannot list principals it retries, so stop it again if we started it.
let started = false
onMounted(async () => {
  await objects.start()
  if (!principals.rxsub) { started = true; principals.start() }
  await serviceClientReady()
  /* Groups a grant can name: the subclasses of Principal, which the
   * Auth service expands to their members. */
  groups.value = await useServiceClientStore().client.ConfigDB
    .class_subclasses(UUIDs.Class.Principal).catch(() => [])
})
onUnmounted(() => { if (started) principals.stop() })

const objectName = uuid => objects.data.find(o => o.uuid === uuid)?.name
const isGroup = uuid => groups.value.includes(uuid)

const candidates = computed(() => {
  const users = principals.data.map(p => ({
    uuid: p.uuid,
    kerberos: p.kerberos,
    label: p.name && p.name !== 'UNKNOWN' ? p.name : (p.kerberos ?? p.uuid),
    group: false,
  }))
  const grps = groups.value.map(uuid => ({ uuid, label: objectName(uuid) ?? uuid, group: true }))
  return [...grps, ...users]
})

function nameOf (uuid) {
  return candidates.value.find(c => c.uuid === uuid)?.label ?? objectName(uuid) ?? uuid
}

function reasonText (r) {
  switch (r.reason) {
    case 'direct': return `This ${props.noun}`
    case 'node':   return `Everything under ${r.through.level ? `${r.through.level} ` : ''}${r.through.name}`
    case 'class':  return `Every member of ${objectName(r.grant.target) ?? r.grant.target}`
    case 'all':    return 'All i3X data'
  }
}

const suggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = q
    ? candidates.value.filter(c => `${c.label} ${c.kerberos ?? ''} ${c.uuid}`.toLowerCase().includes(q))
    : candidates.value
  return list.slice(0, 8)
})

watch(query, q => { if (picked.value && q !== picked.value.label) picked.value = null })

function pick (p) {
  picked.value = p
  query.value = p.label
  open.value = false
}

function close () { setTimeout(() => { open.value = false }, 100) }

function failure (verb, err) {
  console.error(`i3X read access: ${verb} failed`, err)
  return err?.status === 403
    ? 'Only administrators can change i3X access.'
    : `${verb} failed${err?.status ? ` (HTTP ${err.status})` : ''}.`
}

async function add () {
  busy.value = true
  error.value = null
  try {
    await useServiceClientStore().client.Auth.add_grant({
      principal: picked.value.uuid,
      permission: READ_OBJECT,
      target: props.target,
      plural: false,
    })
    toast.success(`${picked.value.label} can now read this ${props.noun} through i3X`)
    picked.value = null
    query.value = ''
    await load()
  }
  catch (err) {
    error.value = failure('Giving access', err)
  }
  finally {
    busy.value = false
  }
}

async function remove (grant) {
  busy.value = true
  error.value = null
  try {
    await useServiceClientStore().client.Auth.delete_grant(grant.uuid)
    toast.success(`${nameOf(grant.principal)} can no longer read this ${props.noun} directly`)
    await load()
  }
  catch (err) {
    error.value = failure('Removing access', err)
  }
  finally {
    busy.value = false
  }
}

async function load () {
  loading.value = true
  try {
    await serviceClientReady()
    rows.value = await read_access(useServiceClientStore().client, {
      target: { uuid: props.target, device: props.device },
      via: props.via,
    })
  }
  catch (err) {
    console.error('i3X read access: loading grants failed', err)
    rows.value = []
  }
  finally {
    loading.value = false
  }
}

watch(() => [props.target, props.via.map(n => n.uuid).join()], load, { immediate: true })
</script>
