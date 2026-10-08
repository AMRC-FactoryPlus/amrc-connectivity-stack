<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Pick datasets (or only runs) for the builder. Leaves out the
     datasets being edited and anything that already includes them,
     because adding those would make a loop. Emits `add` with the
     chosen dataset UUIDs. -->
<template>
  <Dialog :open="open" @update:open="v => emit('update:open', v)">
    <DialogContent class="sm:max-w-[720px] flex flex-col gap-3 h-[75vh] overflow-hidden">
      <DialogHeader>
        <DialogTitle>{{ runsOnly ? 'Add runs' : 'Add datasets' }}</DialogTitle>
        <DialogDescription>
          {{ runsOnly ? 'Choose the runs to group.' : 'Choose datasets to include. Their devices and windows come with them.' }}
        </DialogDescription>
      </DialogHeader>

      <div class="relative">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"></i>
        <input v-model="search" type="search" placeholder="Search by name or #tag"
               class="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-slate-950"/>
      </div>

      <div v-if="!runsOnly" class="flex flex-wrap gap-1.5">
        <button v-for="k in kindChips" :key="k.id" type="button"
                class="h-7 rounded-full border px-3 text-xs transition-colors"
                :class="kind === k.id ? 'border-slate-900 bg-slate-900 text-slate-50' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'"
                @click="kind = k.id">
          {{ k.label }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-slate-200">
        <div v-if="!ds.ready" class="p-6 text-center text-sm text-slate-500">
          <i class="fa-solid fa-circle-notch animate-spin mr-2"></i>Loading datasets
        </div>
        <div v-else-if="!matched.length" class="p-6 text-center text-sm text-slate-500">
          {{ runsOnly ? 'No runs match.' : 'No datasets match.' }}
        </div>
        <label v-for="r in shown" :key="r.uuid"
               class="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm"
               :class="have.has(r.uuid) ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-slate-50'">
          <input type="checkbox" class="h-4 w-4 accent-slate-900"
                 :checked="have.has(r.uuid) || chosen.has(r.uuid)" :disabled="have.has(r.uuid)"
                 @change="toggle(r.uuid)"/>
          <i :class="`fa-solid fa-fw fa-${kind_info(r.kind).icon} text-xs text-slate-500`"></i>
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium" :title="ds.name(r.uuid)">{{ ds.name(r.uuid) }}</div>
            <div class="truncate text-xs text-slate-500">{{ describe(r) }}</div>
          </div>
          <span v-if="have.has(r.uuid)" class="text-xs text-slate-500">Added</span>
          <span v-else-if="r.invalid" class="text-xs text-red-600">Invalid</span>
        </label>
        <div v-if="matched.length > limit" class="p-3 text-center">
          <Button variant="outline" size="xs" @click="limit += PAGE">
            Show more ({{ matched.length - limit }} more)
          </Button>
        </div>
      </div>

      <DialogFooter class="items-center sm:justify-between">
        <span class="text-sm text-slate-500">{{ chosen.size }} selected</span>
        <div class="flex gap-2">
          <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button :disabled="!chosen.size" @click="confirm">
            Add {{ chosen.size }} {{ noun(chosen.size) }}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { KINDS, OTHER_KIND, kind_info } from '@/lib/datasets/constants.js'
import { fmt_window, matches } from '@/lib/datasets/model.js'
import { picker_exclusions } from './builder/builder.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  // Dataset UUIDs already in the builder.
  added: { type: Array, default: () => [] },
  runsOnly: { type: Boolean, default: false },
  // The dataset being edited, and its own union if it has one.
  exclude: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'add'])

const PAGE = 150
const ds = useDatasetsStore()
const search = ref('')
const kind = ref('all')
const chosen = ref(new Set())
const limit = ref(PAGE)

watch(() => props.open, v => {
  if (!v) return
  search.value = ''
  kind.value = 'all'
  chosen.value = new Set()
  limit.value = PAGE
})
watch([search, kind], () => { limit.value = PAGE })

const kindChips = [{ id: 'all', label: 'All' }, ...KINDS.map(k => ({ id: k.id, label: k.plural })), { id: 'other', label: OTHER_KIND.plural }]

const have = computed(() => new Set(props.added))
const excluded = computed(() => props.open ? picker_exclusions(props.exclude, ds.byUuid) : new Set())

const matched = computed(() => ds.visible
  .filter(r => !excluded.value.has(r.uuid))
  .filter(r => props.runsOnly ? r.kind === 'run' : (kind.value === 'all' || r.kind === kind.value))
  .filter(r => matches(r, search.value))
  .sort((a, b) => ds.name(a.uuid).localeCompare(ds.name(b.uuid))))

const shown = computed(() => matched.value.slice(0, limit.value))

function describe (r) {
  const parts = [kind_info(r.kind).label]
  const res = ds.devicesOf(r.uuid)
  if (res.devices.length) parts.push(`${res.devices.length} ${res.devices.length === 1 ? 'device' : 'devices'}`)
  else if (res.unknown.length) parts.push('Devices not visible')
  parts.push(fmt_window(r.from, r.to))
  return parts.join(' · ')
}

function noun (n) {
  if (props.runsOnly) return n === 1 ? 'run' : 'runs'
  return n === 1 ? 'dataset' : 'datasets'
}

function toggle (uuid) {
  if (have.value.has(uuid)) return
  const next = new Set(chosen.value)
  next.has(uuid) ? next.delete(uuid) : next.add(uuid)
  chosen.value = next
}

function confirm () {
  emit('add', [...chosen.value])
  emit('update:open', false)
}
</script>
