<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -
  - Bulk mapping: put several discovered addresses onto metrics at once.
  -
  - Each address is matched to a schema metric by name. The operator
  - checks the proposal, changes any row, and applies. For a schema with a
  - collection (patternProperties), the dialog can instead make one object
  - per address, named after it. Apply goes through the CSV import path, so
  - the editor creates metrics and objects the same way an import does,
  - and nothing is stored until Save.
  -->

<template>
  <Dialog :open="open" @update:open="v => { if (!v) $emit('close') }">
    <DialogContent class="sm:max-w-3xl max-h-[85vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Map {{ items.length }} address{{ items.length === 1 ? '' : 'es' }}</DialogTitle>
        <DialogDescription>
          Check where each address goes. Nothing is saved until you press Save Changes.
        </DialogDescription>
      </DialogHeader>

      <div v-if="cols.length" class="flex gap-1 text-xs">
        <button type="button" class="rounded-full border px-3 py-1"
            :class="mode === 'map' ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300'"
            @click="mode = 'map'">Map onto metrics</button>
        <button type="button" class="rounded-full border px-3 py-1"
            :class="mode === 'create' ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-300'"
            @click="mode = 'create'">Create {{ items.length }} object{{ items.length === 1 ? '' : 's' }} named after the addresses</button>
      </div>

      <!-- Map onto existing metrics -->
      <div v-if="mode === 'map'" class="flex-1 min-h-0 overflow-auto rounded border border-gray-200">
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="p-2 w-6"></th>
              <th class="p-2">Address</th>
              <th class="p-2">Metric</th>
              <th class="p-2">Match</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="row.item.id" class="border-t border-gray-100 align-top">
              <td class="p-2">
                <input type="checkbox" class="accent-gray-800" v-model="include[i]"
                    :disabled="!target[i]" :aria-label="`Apply ${row.item.name}`"/>
              </td>
              <td class="p-2 max-w-[16rem]">
                <div class="truncate font-medium" :title="row.item.name">{{ row.item.name }}</div>
                <div class="truncate font-mono text-gray-500" :title="row.item.address">{{ row.item.address }}</div>
              </td>
              <td class="p-2">
                <select v-model="target[i]" class="h-7 w-full max-w-[18rem] rounded border border-gray-300 px-1"
                    @change="include[i] = !!target[i]">
                  <option value="">Do not map</option>
                  <optgroup v-if="row.candidates.length" label="Suggested">
                    <option v-for="s in row.candidates" :key="'c' + key(s)" :value="key(s)">{{ s.path.join(' / ') }}</option>
                  </optgroup>
                  <optgroup label="Every metric">
                    <option v-for="s in slots" :key="key(s)" :value="key(s)">{{ s.path.join(' / ') }}</option>
                  </optgroup>
                </select>
                <div v-if="duplicates.has(target[i])" class="mt-1 text-red-700">Another address also goes here.</div>
              </td>
              <td class="p-2">
                <span class="rounded px-1.5 py-0.5" :class="STATUS[row.status].class">{{ STATUS[row.status].text }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Create objects in a collection -->
      <div v-else class="flex-1 min-h-0 overflow-auto flex flex-col gap-3 text-xs">
        <div class="grid grid-cols-2 gap-3">
          <label class="grid gap-1">
            <span class="font-medium text-gray-700">Collection</span>
            <select v-model.number="colIndex" class="h-8 rounded border border-gray-300 px-1">
              <option v-for="(c, i) in cols" :key="i" :value="i">{{ c.path.join(' / ') }}</option>
            </select>
          </label>
          <label class="grid gap-1">
            <span class="font-medium text-gray-700">Metric in each object that gets the address</span>
            <select v-model.number="metricIndex" class="h-8 rounded border border-gray-300 px-1">
              <option v-for="(m, i) in col?.metrics ?? []" :key="i" :value="i">{{ m.path.join(' / ') }}</option>
            </select>
          </label>
        </div>
        <table class="w-full rounded border border-gray-200">
          <thead class="bg-gray-50 text-left text-gray-500">
            <tr><th class="p-2">Address</th><th class="p-2">Object name</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in items" :key="item.id" class="border-t border-gray-100">
              <td class="p-2 font-mono truncate max-w-[18rem]" :title="item.address">{{ item.address }}</td>
              <td class="p-2">
                <input v-model="names[i]" class="h-7 w-full rounded border px-2"
                    :class="name_problem(i) ? 'border-red-400 bg-red-50' : 'border-gray-300'"
                    :aria-label="`Object name for ${item.name}`"/>
                <div v-if="name_problem(i)" class="mt-1 text-red-700">{{ name_problem(i) }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <DialogFooter class="gap-2">
        <Button variant="outline" @click="$emit('close')">Cancel</Button>
        <Button :disabled="!choices.length" @click="$emit('apply', choices)">
          Apply {{ choices.length }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  auto_match,
  collections,
  existing_objects,
  metric_slots,
  object_name,
  object_name_problem,
} from '@/lib/scout/model.js'

const STATUS = {
  matched:       { text: 'Matched', class: 'bg-green-100 text-green-800' },
  ambiguous:     { text: 'More than one', class: 'bg-amber-100 text-amber-800' },
  type_conflict: { text: 'Type differs', class: 'bg-red-100 text-red-800' },
  no_metric:     { text: 'No metric', class: 'bg-gray-100 text-gray-600' },
}

const key = s => s.path.join('\u0000')

export default {
  name: 'ScoutMapDialog',

  components: { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle },

  props: {
    open:   { type: Boolean, default: false },
    /* The ticked value items. */
    items:  { type: Array, default: () => [] },
    /* The editor's dereferenced schema. */
    schema: { type: Object, default: null },
    /* The snapshot index, for parent names. */
    index:  { type: Object, default: null },
    /* The device's origin map, so new objects do not reuse a name. */
    model:  { type: Object, default: () => ({}) },
  },

  emits: ['apply', 'close'],

  data () {
    return { STATUS, mode: 'map', target: [], include: [], names: [], colIndex: 0, metricIndex: 0 }
  },

  computed: {
    slots () {
      return this.schema ? metric_slots(this.schema) : []
    },

    by_key () {
      return new Map(this.slots.map(s => [key(s), s]))
    },

    rows () {
      return auto_match(this.items, this.slots, this.index)
    },

    duplicates () {
      const seen = new Map()
      this.target.forEach((t, i) => { if (t && this.include[i]) seen.set(t, (seen.get(t) ?? 0) + 1) })
      return new Set([...seen].filter(([, n]) => n > 1).map(([t]) => t))
    },

    cols () {
      return this.schema ? collections(this.schema).filter(c => c.metrics.length) : []
    },

    col () {
      return this.cols[this.colIndex] ?? null
    },

    existing () {
      return this.col ? existing_objects(this.model, this.col.path) : new Set()
    },

    choices () {
      if (this.mode === 'map') {
        return this.rows.flatMap((row, i) => {
          const slot = this.by_key.get(this.target[i])
          if (!slot || !this.include[i] || this.duplicates.has(this.target[i])) return []
          return [{
            item: row.item,
            path: slot.path,
            allowed_types: slot.allowed_types,
            default_type: slot.default_type,
          }]
        })
      }
      const metric = this.col?.metrics[this.metricIndex]
      if (!metric) return []
      return this.items.flatMap((item, i) => this.name_problem(i)
        ? []
        : [{
          item,
          path: [...this.col.path, this.names[i], ...metric.path],
          allowed_types: metric.allowed_types,
          default_type: metric.default_type,
        }])
    },
  },

  watch: {
    open: {
      handler (v) { if (v) this.reset() },
      immediate: true,
    },
    colIndex () {
      this.metricIndex = 0
      this.reset_names()
    },
  },

  methods: {
    key,

    reset () {
      this.mode = 'map'
      this.target = this.rows.map(r => (r.slot ? key(r.slot) : ''))
      this.include = this.rows.map(r => r.status === 'matched')
      this.colIndex = 0
      this.metricIndex = 0
      this.reset_names()
    },

    reset_names () {
      const pattern = this.col?.pattern ?? '.*'
      this.names = this.items.map(it => object_name(it, pattern) ?? '')
    },

    name_problem (i) {
      return object_name_problem(this.names, i, this.col?.pattern, this.existing)
    },
  },
}
</script>
