<!--
  - ACS Admin
  - Who can read a device or ISA-95 node through i3X, one row per user
  - or group with every route as a chip, and giving or removing access.
  - Copyright 2026 University of Sheffield AMRC
  -->

<!-- Only administrators can change grants today, so there is no
     permission check first: it tries, and a refusal says so. Grants the
     viewer may not read are not listed. Only grants on the target itself
     can be removed here; the others live on a node above, a class, or
     the wildcard. -->
<template>
  <Dialog :open="open" @update:open="v => emit('update:open', v)">
    <DialogContent class="sm:max-w-[860px] max-h-[90vh] overflow-y-auto">
      <template v-if="view === 'list'">
        <div class="flex items-start justify-between gap-4 pr-8">
          <DialogHeader>
            <DialogTitle>i3X access: {{ name || target }}</DialogTitle>
            <DialogDescription>{{ Noun }}<template v-if="path"> - {{ path }}</template></DialogDescription>
          </DialogHeader>
          <Button size="sm" class="shrink-0" @click="startGive">
            <i class="fa-solid fa-plus mr-2"></i>Give access
          </Button>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <Tabs v-model="tab">
            <TabsList>
              <TabsTrigger value="all">All {{ people.length }}</TabsTrigger>
              <TabsTrigger value="here">Given here {{ givenHere.length }}</TabsTrigger>
              <TabsTrigger value="elsewhere">From elsewhere {{ fromElsewhere.length }}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input v-model="filter" class="w-60" placeholder="Filter this list..." aria-label="Filter users and groups"/>
        </div>

        <p v-if="error" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
        <p v-if="loadError" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          The access list could not be loaded. Close this dialog and try again.
        </p>

        <div class="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Access via</TableHead>
                <TableHead class="w-12"><span class="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading && !people.length">
                <TableCell colspan="4" class="text-sm text-slate-500">
                  <i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading access
                </TableCell>
              </TableRow>
              <TableRow v-else-if="!shown.length">
                <TableCell colspan="4" class="text-sm text-slate-500">{{ emptyText }}</TableCell>
              </TableRow>
              <TableRow v-for="e in shown" :key="e.principal">
                <TableCell>
                  <div class="flex items-center gap-2.5">
                    <span class="flex size-7 shrink-0 items-center justify-center bg-slate-100 text-slate-500"
                          :class="isGroup(e.principal) ? 'rounded-md' : 'rounded-full'">
                      <i class="fa-solid text-xs" :class="isGroup(e.principal) ? 'fa-users' : 'fa-user'"></i>
                    </span>
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate font-medium">{{ nameOf(e.principal) }}</span>
                      <span class="truncate text-xs text-slate-500">{{ subOf(e.principal) }}</span>
                    </span>
                  </div>
                </TableCell>
                <TableCell class="text-slate-500">{{ isGroup(e.principal) ? 'Group' : 'User' }}</TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-1.5">
                    <span v-for="r in e.routes" :key="`${r.reason}:${r.grant.uuid}`"
                          class="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold"
                          :class="chipClass(r)" :title="routeTitle(r)">
                      {{ routeLabel(r) }}
                      <button v-if="r.reason === 'direct'" type="button" class="inline-flex opacity-80 hover:opacity-100"
                              :disabled="busy" :aria-label="`Remove ${nameOf(e.principal)}'s grant on this ${noun}`"
                              @click="remove(r.grant)">
                        <i class="fa-solid fa-xmark text-[10px]"></i>
                      </button>
                    </span>
                  </div>
                </TableCell>
                <TableCell class="px-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button size="xs" variant="ghost" aria-label="More actions">
                        <i class="fa-solid fa-ellipsis"></i>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem @click="openInAccessControl(e.principal)">
                        Open {{ nameOf(e.principal) }} in Access Control
                      </DropdownMenuItem>
                      <template v-if="e.here">
                        <DropdownMenuSeparator/>
                        <DropdownMenuItem class="text-red-600" :disabled="busy"
                                          @click="remove(e.routes.find(r => r.reason === 'direct').grant)">
                          Remove grant on this {{ noun }}
                        </DropdownMenuItem>
                      </template>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div class="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
          <span>Dark chips are grants on this {{ noun }}; you can remove them here. The others come from somewhere else.</span>
          <span>Built-in admin account: full access, no grant</span>
        </div>
      </template>

      <template v-else>
        <DialogHeader>
          <DialogTitle>Give i3X read access</DialogTitle>
          <DialogDescription>From {{ name || target }} ({{ noun }})</DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-1.5">
          <label for="i3x-access-who" class="text-sm font-medium">Who</label>
          <div class="relative">
            <div class="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-slate-950 focus-within:ring-offset-2">
              <Badge v-for="p in picked" :key="p.uuid" variant="secondary" class="gap-1.5">
                {{ p.label }}
                <button type="button" class="inline-flex" :aria-label="`Remove ${p.label}`" @click="unpick(p)">
                  <i class="fa-solid fa-xmark text-[10px]"></i>
                </button>
              </Badge>
              <input id="i3x-access-who" v-model="query" class="min-w-32 flex-1 bg-transparent px-1 outline-none placeholder:text-slate-500"
                     :placeholder="picked.length ? 'Add more...' : 'Search users and groups'"
                     @focus="suggest = true" @input="suggest = true" @blur="closeSuggest"
                     @keydown.backspace="query === '' && picked.length && unpick(picked.at(-1))"/>
            </div>
            <div v-if="suggest && suggestions.length"
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
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1.5 text-sm font-medium">On</legend>
          <label v-for="s in scopes" :key="s.uuid"
                 class="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5"
                 :class="scope === s.uuid ? 'border-slate-900 bg-slate-50' : 'border-slate-200'">
            <input v-model="scope" type="radio" name="i3x-access-scope" :value="s.uuid" class="mt-1 accent-slate-900">
            <span class="flex flex-1 flex-col gap-0.5">
              <span class="text-sm font-medium">{{ s.title }}</span>
              <span class="text-xs text-slate-500">{{ s.covers }}</span>
            </span>
          </label>
        </fieldset>

        <div v-for="o in overlaps" :key="o.uuid"
             class="flex items-start gap-2.5 rounded-md border bg-slate-50 px-3 py-2.5 text-sm">
          <i class="fa-solid fa-circle-info mt-0.5 text-slate-500"></i>
          <span>{{ o.text }}</span>
        </div>

        <p v-if="error" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="view = 'list'">Cancel</Button>
          <Button :disabled="!toGrant.length || busy" @click="give">
            <i class="fa-solid mr-2" :class="busy ? 'fa-circle-notch animate-spin' : 'fa-check'"></i>
            {{ giveText }}
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger }
  from '@/components/ui/dropdown-menu'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import { usePrincipalStore } from '@store/usePrincipalStore.js'
import { useObjectStore } from '@store/useObjectStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useISA95Store } from '@store/useISA95Store.js'
import { extract_hierarchy } from '@/composables/useISA95Migration.js'
import { READ_OBJECT, by_principal, devices_under } from '@/lib/access/i3x-access.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /* What to grant on: a device UUID or an ISA-95 node UUID. */
  target: { type: String, required: true },
  /* True for a device, false for an ISA-95 node. */
  device: { type: Boolean, default: false },
  /* ISA-95 nodes above the target, top first: { uuid, name, level }. */
  via: { type: Array, default: () => [] },
  /* What to call the target in the text, e.g. "device" or "site". */
  noun: { type: String, default: 'device' },
  name: { type: String, default: '' },
  path: { type: String, default: '' },
  /* read_access rows for the target, loaded by the button. */
  rows: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  loadError: { default: null },
})
const emit = defineEmits(['update:open', 'changed'])

const router = useRouter()
const principals = usePrincipalStore()
const objects = useObjectStore()
const groups = ref([])
const view = ref('list')
const tab = ref('all')
const filter = ref('')
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

const Noun = computed(() => props.noun.charAt(0).toUpperCase() + props.noun.slice(1))
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
const candidate = uuid => candidates.value.find(c => c.uuid === uuid)

const nameOf = uuid => candidate(uuid)?.label ?? objectName(uuid) ?? uuid
const subOf = uuid => isGroup(uuid) ? 'Group' : (candidate(uuid)?.kerberos ?? uuid)

/* The list */

const people = computed(() => by_principal(props.rows))
const givenHere = computed(() => people.value.filter(e => e.here))
const fromElsewhere = computed(() => people.value.filter(e => e.routes.some(r => r.reason !== 'direct')))

const shown = computed(() => {
  const list = { all: people, here: givenHere, elsewhere: fromElsewhere }[tab.value].value
  const q = filter.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(e => `${nameOf(e.principal)} ${subOf(e.principal)}`.toLowerCase().includes(q))
})

const emptyText = computed(() => {
  if (filter.value.trim()) return 'Nobody in this list matches the filter.'
  if (tab.value === 'here') return `Nobody has a grant on this ${props.noun}. Use Give access to add one.`
  if (tab.value === 'elsewhere') return `Nobody can read this ${props.noun} from a level above, a class, or all i3X data.`
  return 'Only the built-in admin account can read this. There are no grants you can see.'
})

function routeLabel (r) {
  switch (r.reason) {
    case 'direct': return `This ${props.noun}`
    case 'node':   return `${r.through.level ? `${r.through.level} ` : ''}${r.through.name}`
    case 'class':  return `Class ${objectName(r.grant.target) ?? r.grant.target}`
    case 'all':    return 'All i3X data'
  }
}

function routeTitle (r) {
  switch (r.reason) {
    case 'direct': return `Granted on this ${props.noun}`
    case 'node':   return `Granted on ${r.through.name}: covers everything under it. Remove it on the ISA-95 page.`
    case 'class':  return 'Granted on every member of a class. Remove it in Access Control.'
    case 'all':    return 'Granted on all i3X data. Remove it in Access Control.'
  }
}

function chipClass (r) {
  switch (r.reason) {
    case 'direct': return 'border-slate-900 bg-slate-900 text-slate-50'
    case 'all':    return 'border-slate-100 bg-slate-100 text-slate-900'
    default:       return 'border-slate-200 bg-white text-slate-950'
  }
}

function openInAccessControl (uuid) {
  emit('update:open', false)
  router.push(`/access-control/${isGroup(uuid) ? 'groups' : 'principals'}/${uuid}`)
}

function failure (verb, err) {
  console.error(`i3X read access: ${verb} failed`, err)
  return err?.status === 403
    ? 'Only administrators can change i3X access.'
    : `${verb} failed${err?.status ? ` (HTTP ${err.status})` : ''}.`
}

async function remove (grant) {
  busy.value = true
  error.value = null
  try {
    await useServiceClientStore().client.Auth.delete_grant(grant.uuid)
    toast.success(`${nameOf(grant.principal)} can no longer read this ${props.noun} directly`)
    emit('changed')
  }
  catch (err) {
    error.value = failure('Removing access', err)
  }
  finally {
    busy.value = false
  }
}

/* Giving access */

const query = ref('')
const suggest = ref(false)
const picked = ref([])
const scope = ref(props.target)

function startGive () {
  error.value = null
  picked.value = []
  query.value = ''
  scope.value = props.target
  view.value = 'give'
}

const suggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  const free = candidates.value.filter(c => !picked.value.some(p => p.uuid === c.uuid))
  const list = q
    ? free.filter(c => `${c.label} ${c.kerberos ?? ''} ${c.uuid}`.toLowerCase().includes(q))
    : free
  return list.slice(0, 8)
})

function pick (p) {
  picked.value = [...picked.value, p]
  query.value = ''
}
function unpick (p) { picked.value = picked.value.filter(o => o.uuid !== p.uuid) }
function closeSuggest () { setTimeout(() => { suggest.value = false }, 100) }

/* Device counts need the device store; where it has not loaded, the
 * scope text leaves the count out rather than show a wrong one. */
const chains = computed(() => (useDeviceStore().data ?? [])
  .map(d => extract_hierarchy(d)?.chain).filter(Boolean))

function covers (node) {
  const n = chains.value.length ? devices_under(useISA95Store().data, chains.value, node.uuid) : null
  const what = n === null ? 'every device' : `the ${n} device${n === 1 ? '' : 's'}`
  return `Gives read access to ${what} under ${node.name}, and any added later.`
}

const scopes = computed(() => {
  const label = props.name || props.target
  const self = props.device
    ? { uuid: props.target, title: `${label} only`, covers: `Gives read access to ${label}.` }
    : { uuid: props.target, title: `Everything under ${Noun.value} ${label}`,
        covers: covers({ uuid: props.target, name: label }) }
  const above = [...props.via].reverse().map(n => ({
    uuid: n.uuid,
    title: `Everything under ${n.level ? `${n.level} ` : ''}${n.name}`,
    covers: covers(n),
  }))
  return [self, ...above]
})
const scopeName = computed(() => scope.value === props.target
  ? (props.name || props.target)
  : props.via.find(n => n.uuid === scope.value)?.name ?? scope.value)

/* People already granted on the chosen scope are skipped; people with
 * another route are told the new grant is a second one. */
const alreadyOn = p => props.rows.some(r => r.grant.principal === p.uuid
  && (scope.value === props.target ? r.reason === 'direct' : r.through?.uuid === scope.value))
const toGrant = computed(() => picked.value.filter(p => !alreadyOn(p)))

const overlaps = computed(() => picked.value.flatMap(p => {
  if (alreadyOn(p))
    return [{ uuid: p.uuid, text: `${p.label} already has a grant on ${scopeName.value}, so is skipped.` }]
  const other = people.value.find(e => e.principal === p.uuid)?.routes[0]
  if (!other) return []
  return [{ uuid: p.uuid, text: `${p.label} already has access from ${routeLabel(other)}. `
    + `A grant on ${scopeName.value} adds a second route, so removing either one later leaves them with access.` }]
}))

const giveText = computed(() => {
  const n = toGrant.value.length
  if (!n) return 'Give access'
  return `Give ${n === 1 ? toGrant.value[0].label : `${n} users and groups`} access to ${scopeName.value}`
})

async function give () {
  busy.value = true
  error.value = null
  const auth = useServiceClientStore().client.Auth
  const done = []
  try {
    for (const p of toGrant.value) {
      await auth.add_grant({ principal: p.uuid, permission: READ_OBJECT, target: scope.value, plural: false })
      done.push(p)
    }
    toast.success(done.length === 1
      ? `${done[0].label} can now read ${scopeName.value} through i3X`
      : `${done.length} users and groups can now read ${scopeName.value} through i3X`)
    view.value = 'list'
  }
  catch (err) {
    error.value = failure('Giving access', err)
    picked.value = picked.value.filter(p => !done.includes(p))
  }
  finally {
    busy.value = false
    if (done.length) emit('changed')
  }
}
</script>
