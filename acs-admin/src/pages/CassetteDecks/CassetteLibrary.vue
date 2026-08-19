<template>
  <div class="flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
    <div class="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="font-semibold">Cassettes</span>
        <span class="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
          {{ filtered.length }}
        </span>
      </div>
      <Button size="sm" @click="$emit('upload')">
        <i class="fa-solid fa-plus mr-1.5 text-[11px]"></i>Upload
      </Button>
    </div>

    <div class="border-b border-slate-200 px-4 py-3">
      <div class="relative">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-gray-400">
          <i class="fa-solid fa-search"></i>
        </div>
        <input v-model="query" class="flex h-9 w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"
          placeholder="Search cassettes...">
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="!filtered.length" class="px-4 py-8 text-center text-sm text-gray-500">
        {{ query ? 'No cassettes match.' : 'No cassettes yet. Upload a recording to begin.' }}
      </div>
      <div v-for="c in filtered" :key="c.uuid"
        class="flex cursor-grab flex-col gap-1.5 border-b border-slate-200 px-4 py-3.5 transition-colors hover:bg-slate-50"
        :class="{ 'bg-slate-100': selected === c.uuid }"
        draggable="true"
        @dragstart="onDragStart($event, c)"
        @click="$emit('select', selected === c.uuid ? null : c.uuid)"
      >
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-grip-vertical text-[11px] text-gray-400"></i>
          <div class="min-w-0 flex-1 truncate font-mono text-[13px] font-medium">
            {{ c.meta?.name ?? c.name }}
          </div>
          <span v-if="c.meta"
            class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            {{ c.meta.source }}
          </span>
        </div>
        <div v-if="c.meta?.description" class="pl-5 text-xs text-gray-500">
          {{ c.meta.description }}
        </div>
        <div class="flex flex-wrap items-center gap-1.5 pl-5">
          <span v-if="c.meta" class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 opacity-70">
            <i class="fa-solid fa-clock text-[10px]"></i>{{ mmss(c.meta.duration_ms) }}
          </span>
          <span v-if="c.meta" class="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 opacity-70">
            <i class="fa-solid fa-arrow-down-up-across-line text-[10px]"></i>{{ c.meta.channels }} channels
          </span>
          <span v-if="c.loadedIn.length" class="text-xs text-gray-500">
            Loaded in {{ c.loadedIn.join(', ') }}
          </span>
        </div>
        <div v-if="selected === c.uuid" class="flex items-center gap-2 pl-5 text-xs font-medium text-slate-950">
          <i class="fa-solid fa-arrow-right text-[10px]"></i>
          Now pick a deck, or press Load on one.
        </div>
      </div>
    </div>

    <div class="border-t border-slate-200 px-4 py-2.5 text-xs text-gray-500">
      Drag a cassette onto a deck to load it, or click to select then Load.
    </div>
  </div>
</template>

<script>
import { Button } from '@components/ui/button/index.js'
import { mmss } from '@/composables/useCassetteDecks.js'

export default {
  components: { Button },
  props: {
    /* [{ uuid, name, meta, loadedIn: [deckName] }] */
    cassettes: { type: Array, required: true },
    selected: { type: String, default: null },
  },
  emits: ['select', 'upload'],
  data () {
    return { query: '' }
  },
  computed: {
    filtered () {
      const q = this.query.trim().toLowerCase()
      if (!q) return this.cassettes
      return this.cassettes.filter(c =>
        (c.meta?.name ?? c.name ?? '').toLowerCase().includes(q)
        || (c.meta?.description ?? '').toLowerCase().includes(q))
    },
  },
  methods: {
    mmss,
    onDragStart (e, c) {
      e.dataTransfer.setData('application/x-cassette', c.uuid)
      e.dataTransfer.effectAllowed = 'copy'
      this.$emit('select', c.uuid)
    },
  },
}
</script>
