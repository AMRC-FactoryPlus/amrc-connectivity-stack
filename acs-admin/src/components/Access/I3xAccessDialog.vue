<!--
  - ACS Admin
  - Who can browse a device or ISA-95 node through i3X, or build datasets
  - from a device: one row per user or group, with what each may do and
  - every route as a chip, and giving or removing access.
  - Copyright 2026 University of Sheffield AMRC
  -->

<!-- Only administrators can change grants today, so there is no
     permission check first: it tries, and a refusal says so. Grants the
     viewer may not read are not listed. Only grants on the target itself
     can be removed here; the others live on a node above, a class, or
     the wildcard. The dataset roles' grants are rewritten by service
     setup on every run, so they are shown as set by role, cannot be
     removed, and the roles are never offered as grantees. -->
<template>
  <Dialog :open="open" @update:open="v => emit('update:open', v)">
    <DialogContent class="sm:max-w-[860px] max-h-[90vh] overflow-y-auto">
      <template v-if="view === 'list'">
        <div class="flex items-start justify-between gap-4 pr-8">
          <DialogHeader>
            <DialogTitle>Access: {{ name || target }}</DialogTitle>
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
                <TableHead>Allows</TableHead>
                <TableHead>Access via</TableHead>
                <TableHead class="w-12"><span class="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading && !people.length">
                <TableCell colspan="5" class="text-sm text-slate-500">
                  <i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading access
                </TableCell>
              </TableRow>
              <TableRow v-else-if="!shown.length">
                <TableCell colspan="5" class="text-sm text-slate-500">{{ emptyText }}</TableCell>
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
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span v-for="h in halvesOf(e)" :key="h.half"
                          class="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold"
                          :class="h.direct.length ? 'border-slate-900 bg-slate-900 text-slate-50' : 'border-slate-200 bg-white text-slate-950'"
                          :title="halfTitle(h, e)">
                      {{ h.label }}
                      <button v-if="h.removable" type="button" class="inline-flex opacity-80 hover:opacity-100"
                              :disabled="busy" :aria-label="`Remove ${h.label} access given to ${nameOf(e.principal)} on this ${noun}`"
                              @click="removeHalf(e, h)">
                        <i class="fa-solid fa-xmark text-[10px]"></i>
                      </button>
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span v-for="r in e.routes" :key="`${r.reason}:${r.grant.uuid}`"
                          class="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold"
                          :class="chipClass(r)" :title="routeTitle(r)">
                      {{ routeLabel(r) }}
                    </span>
                    <span v-if="isRole(e)" class="text-xs text-slate-500"
                          title="Service setup gives the dataset roles these grants on every run, so they cannot be changed here.">
                      Set by role
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
                      <template v-if="e.here && !isRole(e)">
                        <DropdownMenuSeparator/>
                        <DropdownMenuItem class="text-red-600" :disabled="busy" @click="removeAll(e)">
                          Remove access given on this {{ noun }}
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
          <span>Dark tags and chips come from grants on this {{ noun }}; you can remove them here. The others come from somewhere else.</span>
          <span>Built-in admin account: full access, no grant</span>
        </div>
      </template>

      <template v-else>
        <DialogHeader>
          <DialogTitle>Give access</DialogTitle>
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

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1.5 text-sm font-medium">Allow</legend>
          <label class="flex cursor-pointer items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2.5">
            <input v-model="browse" type="checkbox" class="mt-1 accent-slate-900">
            <span class="flex flex-1 flex-col gap-0.5">
              <span class="text-sm font-medium">Browse in i3X</span>
              <span class="text-xs text-slate-500">Read its values and history through i3X.</span>
            </span>
          </label>
          <label v-if="device" class="flex items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2.5"
                 :class="buildBlocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'">
            <input v-model="build" type="checkbox" class="mt-1 accent-slate-900" :disabled="buildBlocked">
            <span class="flex flex-1 flex-col gap-0.5">
              <span class="text-sm font-medium">Build datasets from it</span>
              <span class="text-xs text-slate-500">{{ buildBlocked
                ? 'Datasets only use grants on the device itself. Choose the device above to allow this.'
                : 'Make datasets from its data in Data Access.' }}</span>
            </span>
          </label>
        </fieldset>

        <label v-if="needMaker.length"
               class="flex cursor-pointer items-start gap-2.5 rounded-md border bg-slate-50 px-3 py-2.5 text-sm">
          <input v-model="makeMaker" type="checkbox" class="mt-1 accent-slate-900">
          <span class="flex flex-col gap-0.5">
            <span class="font-medium">Also make {{ makerNames }} a Dataset maker</span>
            <span class="text-xs text-slate-500">
              Building datasets also needs the Dataset maker role, and {{ makerNames }}
              {{ needMaker.length === 1 ? 'does' : 'do' }} not have it.
            </span>
          </span>
        </label>

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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'
// Device data: the i3X and Datasets halves of access to a device.
import {
  ROLE_GROUPS, CREATE_DATASET, DATASET_MAKER, grant_permission, entry_halves, halves_on,
  missing_halves, remove_half,
} from '@/lib/access/device-data.js'
import { STRUCTURE } from '@/lib/datasets/constants.js'

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
import { devices_placed_under } from '@/lib/isa95-placement.js'
import { READ_OBJECT, by_principal } from '@/lib/access/i3x-access.js'

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
  if (tab.value === 'elsewhere') return `Nobody has access to this ${props.noun} from a level above, a class, or everything.`
  return 'Only the built-in admin account has access. There are no grants you can see.'
})

const isRole = e => e.routes.some(r => r.role)
const halvesOf = e => entry_halves(e, props.device)

function halfTitle (h, e) {
  const what = h.half === 'i3x' ? 'Can browse this in i3X' : 'Can build datasets from this'
  if (isRole(e)) return `${what}. Set by a dataset role.`
  if (!h.direct.length) return `${what}, from a grant somewhere else.`
  return h.elsewhere
    ? `${what}. Removing it here leaves the access they have from somewhere else.`
    : `${what}, from a grant on this ${props.noun}. You can remove it here.`
}

function routeLabel (r) {
  switch (r.reason) {
    case 'direct': return `This ${props.noun}`
    case 'node':   return `${r.through.level ? `${r.through.level} ` : ''}${r.through.name}`
    case 'class':  return `Class ${objectName(r.grant.target) ?? r.grant.target}`
    case 'all':    return 'Everything'
  }
}

function routeTitle (r) {
  switch (r.reason) {
    case 'direct': return `Granted on this ${props.noun}`
    case 'node':   return `Granted on ${r.through.name}: covers everything under it. Remove it on the ISA-95 page.`
    case 'class':  return 'Granted on every member of a class. Remove it in Access Control.'
    case 'all':    return 'Granted on everything. Remove it in Access Control.'
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
  console.error(`Device access: ${verb} failed`, err)
  return err?.status === 403
    ? 'Only administrators can change device access.'
    : `${verb} failed${err?.status ? ` (HTTP ${err.status})` : ''}.`
}

/* Removes one half (a tag in the Allows column) from every grant on
 * the target that gives it. A grant giving both halves is replaced by
 * one giving the other half. */
async function removeHalf (e, h) {
  busy.value = true
  error.value = null
  const auth = useServiceClientStore().client.Auth
  let changed = false
  try {
    for (const r of h.direct) {
      await remove_half(auth, r, h.half, props.device)
      changed = true
    }
    toast.success(h.half === 'i3x'
      ? `${nameOf(e.principal)} can no longer browse this ${props.noun} in i3X through a grant here`
      : `${nameOf(e.principal)} can no longer build datasets from this ${props.noun} through a grant here`)
  }
  catch (err) {
    error.value = failure('Removing access', err)
  }
  finally {
    busy.value = false
    if (changed) emit('changed')
  }
}

/* Removes every grant on the target itself for one principal. */
async function removeAll (e) {
  busy.value = true
  error.value = null
  const auth = useServiceClientStore().client.Auth
  let changed = false
  try {
    for (const r of e.routes.filter(r => r.reason === 'direct')) {
      await auth.delete_grant(r.grant.uuid)
      changed = true
    }
    toast.success(`${nameOf(e.principal)} no longer has access given on this ${props.noun}`)
  }
  catch (err) {
    error.value = failure('Removing access', err)
  }
  finally {
    busy.value = false
    if (changed) emit('changed')
  }
}

/* Giving access */

const query = ref('')
const suggest = ref(false)
const picked = ref([])
const scope = ref(props.target)

/* The halves ticked. Browse is on by default, as before Build existed. */
const browse = ref(true)
const build = ref(false)
const makeMaker = ref(false)

function startGive () {
  error.value = null
  picked.value = []
  query.value = ''
  scope.value = props.target
  browse.value = true
  build.value = false
  makeMaker.value = false
  view.value = 'give'
}

/* The dataset roles are never offered: service setup would delete the
 * grant on its next run. */
const suggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  const free = candidates.value.filter(c => !picked.value.some(p => p.uuid === c.uuid)
    && !ROLE_GROUPS.includes(c.uuid))
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

/* Device counts need the device store and the vocabulary; until both
 * have loaded, the scope text leaves the count out rather than show a
 * wrong one. A device counts when it is placed at or under the node. */
const placements = computed(() => {
  const devices = useDeviceStore()
  if (!devices.ready || !useISA95Store().ready) return null
  return new Map((devices.data ?? []).map(d => [d.uuid, d.placement]))
})

function covers (node) {
  const n = placements.value
    ? devices_placed_under(useISA95Store().vocabulary, placements.value, node.uuid).length
    : null
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

/* Datasets use grants on the device itself only, so Build is off for
 * an ISA-95 node and for a scope above the device. */
const buildBlocked = computed(() => !props.device || scope.value !== props.target)
const want = computed(() => ({ browse: browse.value, build: build.value && !buildBlocked.value }))

/* What each picked principal still needs on the chosen scope. Halves
 * they already hold there are skipped. People with another route are
 * told the new grant is a second one. */
const held = p => halves_on(props.rows, p.uuid, scope.value, props.target, props.device)
const missing = p => missing_halves(want.value, held(p))
const alreadyOn = p => grant_permission(missing(p)) === null
const toGrant = computed(() => grant_permission(want.value) === null
  ? []
  : picked.value.filter(p => !alreadyOn(p)))

const HALF_TEXT = { i3x: 'browse it in i3X', datasets: 'build datasets from it' }

const overlaps = computed(() => picked.value.flatMap(p => {
  if (grant_permission(want.value) === null) return []
  if (alreadyOn(p))
    return [{ uuid: p.uuid, text: `${p.label} already has this access on ${scopeName.value}, so is skipped.` }]
  const has = [...held(p)].filter(h => (h === 'i3x' ? want.value.browse : want.value.build))
  if (has.length)
    return [{ uuid: p.uuid, text: `${p.label} can already ${has.map(h => HALF_TEXT[h]).join(' and ')} `
      + `on ${scopeName.value}, so only the rest is given.` }]
  const other = people.value.find(e => e.principal === p.uuid)?.routes[0]
  if (!other) return []
  return [{ uuid: p.uuid, text: `${p.label} already has access from ${routeLabel(other)}. `
    + `A grant on ${scopeName.value} adds a second route, so removing either one later leaves them with access.` }]
}))

/* Building datasets also needs CreateDataset, which the Dataset maker
 * role gives. Users picked to build who lack it are offered the role.
 * Groups are not: a group joins a role as a subclass, which is done in
 * Access Control. An ACL that cannot be read (null) offers nothing. */
const canCreate = ref({})
watch(() => [want.value.build, picked.value.map(p => p.uuid).join()], async () => {
  if (!want.value.build) return
  const client = useServiceClientStore().client
  for (const p of picked.value) {
    if (p.group || p.uuid in canCreate.value) continue
    canCreate.value = { ...canCreate.value, [p.uuid]: undefined }
    const ok = await client.Auth.check_acl(p.uuid, CREATE_DATASET, STRUCTURE.UNS_DEVICE, true)
      .catch(() => null)
    canCreate.value = { ...canCreate.value, [p.uuid]: ok }
  }
})
const needMaker = computed(() => !want.value.build
  ? []
  : toGrant.value.filter(p => !p.group && canCreate.value[p.uuid] === false))
const makerNames = computed(() => needMaker.value.length === 1
  ? needMaker.value[0].label
  : `these ${needMaker.value.length} users`)

const giveText = computed(() => {
  const n = toGrant.value.length
  if (!n) return 'Give access'
  return `Give ${n === 1 ? toGrant.value[0].label : `${n} users and groups`} access to ${scopeName.value}`
})

async function give () {
  busy.value = true
  error.value = null
  const client = useServiceClientStore().client
  const makers = makeMaker.value ? needMaker.value.map(p => p.uuid) : []
  const done = []
  try {
    for (const p of toGrant.value) {
      const permission = grant_permission(missing(p))
      await client.Auth.add_grant({ principal: p.uuid, permission, target: scope.value, plural: false })
      if (makers.includes(p.uuid)) {
        await client.ConfigDB.class_add_member(DATASET_MAKER, p.uuid)
        canCreate.value = { ...canCreate.value, [p.uuid]: true }
      }
      done.push(p)
    }
    toast.success(done.length === 1
      ? `${done[0].label} now has access to ${scopeName.value}`
      : `${done.length} users and groups now have access to ${scopeName.value}`)
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
