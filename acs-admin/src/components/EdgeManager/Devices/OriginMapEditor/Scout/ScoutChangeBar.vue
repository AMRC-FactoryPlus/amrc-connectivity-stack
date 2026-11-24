<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -
  - What changed since the previous scan, and which mapped metrics the
  - current scan cannot find. Each count is a filter on the tree.
  -->

<template>
  <div v-if="show" class="flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-2 text-xs">
    <div class="flex flex-wrap items-center gap-1.5">
      <button v-for="chip in chips" :key="chip.key"
          type="button"
          class="rounded-full border px-2 py-0.5 transition-colors"
          :class="active === chip.key
            ? 'border-gray-800 bg-gray-800 text-white'
            : `${chip.class} hover:border-gray-400`"
          :disabled="!chip.count"
          :aria-pressed="active === chip.key"
          @click="$emit('filter', active === chip.key ? null : chip.key)"
      >
        {{ chip.label }} <span class="font-semibold">{{ chip.count.toLocaleString('en-GB') }}</span>
      </button>
    </div>
    <p v-if="note" class="text-gray-500">{{ note }}</p>

    <!-- Metrics are not tree rows, so the missing ones are listed here. -->
    <ul v-if="active === 'missing' || active === 'unseen_metrics'" class="max-h-40 overflow-auto divide-y divide-gray-100">
      <li v-for="m in metric_list" :key="m.path.join('/')"
          class="flex items-center justify-between gap-2 py-1"
      >
        <button type="button" class="truncate text-left hover:underline" @click="$emit('select-metric', m.path)">
          {{ m.path.join(' / ') }}
        </button>
        <span class="font-mono text-gray-500 truncate max-w-[50%]" :title="m.metric.Address">{{ m.metric.Address }}</span>
      </li>
    </ul>

    <!-- Gone and not-seen addresses were in the previous scan, so they
       - are not in the tree either. -->
    <ul v-if="active === 'gone' || active === 'unseen'" class="max-h-40 overflow-auto divide-y divide-gray-100">
      <li v-for="it in item_list" :key="it.id" class="flex items-center justify-between gap-2 py-1">
        <span class="truncate">{{ it.name }}</span>
        <span class="font-mono text-gray-500 truncate max-w-[60%]" :title="it.address ?? it.id">{{ it.address ?? it.id }}</span>
      </li>
    </ul>
  </div>
</template>

<script>
import { comparable_text } from '@/lib/scout/text.js'

export default {
  name: 'ScoutChangeBar',

  props: {
    /* From model.diff, or null without a previous scan. */
    changes: { type: Object, default: null },
    /* From model.mapped_but_missing. */
    missing: { type: Object, default: null },
    active:  { type: String, default: null },
  },

  emits: ['filter', 'select-metric'],

  computed: {
    chips () {
      const c = this.changes
      const m = this.missing
      const out = []
      if (c) {
        out.push({ key: 'new', label: 'New', count: c.added.size, class: 'border-blue-200 bg-blue-50 text-blue-800' })
        out.push({ key: 'changed', label: 'Changed', count: new Set([...c.changed.keys(), ...c.renamed]).size,
          class: 'border-amber-200 bg-amber-50 text-amber-800' })
        if (c.comparable)
          out.push({ key: 'gone', label: 'Gone', count: c.gone.length, class: 'border-red-200 bg-red-50 text-red-800' })
        else
          out.push({ key: 'unseen', label: 'Not seen this time', count: c.not_seen.length,
            class: 'border-gray-200 bg-gray-50 text-gray-700' })
      }
      if (m) {
        out.push({ key: 'missing', label: 'Mapped but missing', count: m.missing.length,
          class: 'border-red-200 bg-red-50 text-red-800' })
        if (m.not_seen.length)
          out.push({ key: 'unseen_metrics', label: 'Mapped, not seen', count: m.not_seen.length,
            class: 'border-gray-200 bg-gray-50 text-gray-700' })
      }
      return out
    },

    show () {
      return this.chips.some(c => c.count > 0)
    },

    note () {
      if (!this.changes || this.changes.comparable) return null
      return comparable_text(this.changes.reason)
    },

    item_list () {
      const c = this.changes
      if (!c) return []
      return (this.active === 'gone' ? c.gone : c.not_seen).slice(0, 500)
    },

    metric_list () {
      if (this.active === 'missing') return this.missing?.missing ?? []
      return this.missing?.not_seen ?? []
    },
  },
}
</script>
