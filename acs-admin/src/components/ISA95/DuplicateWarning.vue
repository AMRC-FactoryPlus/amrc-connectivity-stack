<!--
  - ACS Admin
  - The warning shown before a node is added or renamed when the
  - hierarchy already has nodes with a similar name at that level.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <div class="rounded-md border border-amber-300 bg-amber-50 text-sm"
      :class="compact ? 'p-3 space-y-2.5' : 'p-3.5 space-y-3'"
      role="group" aria-label="Possible duplicates"
      @keydown.esc.stop.prevent="!busy && $emit('cancel')">
    <div ref="title" tabindex="-1" role="status" class="flex items-start gap-2 outline-none">
      <i class="fa-solid fa-triangle-exclamation text-amber-600 mt-0.5"></i>
      <div>
        <div class="font-semibold text-amber-900">This may already exist</div>
        <div class="text-xs text-amber-800">Duplicates split the namespace, so devices for one place end up under two nodes.</div>
      </div>
    </div>

    <div class="rounded-md border border-amber-200 bg-white divide-y divide-amber-100">
      <div class="px-3 py-1.5 text-xs font-medium text-gray-500">{{ listHead }}</div>
      <div v-for="m in shown" :key="m.uuid" class="flex items-start gap-3 px-3 py-2.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="font-medium truncate">{{ m.name }}</span>
            <span class="text-[10px] uppercase tracking-wide text-gray-500 border border-gray-200 rounded px-1">{{ m.level }}</span>
          </div>
          <div v-if="m.path" class="text-xs text-gray-500 truncate">{{ m.path }}</div>
          <div class="text-xs text-amber-800">{{ m.why }}</div>
        </div>
        <div class="flex flex-col items-end gap-1 shrink-0">
          <span class="text-xs text-gray-500 tabular-nums">{{ devices(m.devices) }}</span>
          <Button size="xs" variant="outline" :disabled="busy"
              :aria-label="`${actionLabel}: ${m.name}${m.path ? ', ' + m.path : ''}`"
              @click="$emit('pick', m.uuid)">
            {{ actionLabel }}
          </Button>
        </div>
      </div>
      <div v-if="hidden > 0" class="px-3 py-1.5">
        <Button size="xs" variant="ghost" @click="all = true">Show {{ hidden }} more</Button>
      </div>
    </div>

    <label class="flex items-start gap-2 text-sm cursor-pointer">
      <input type="checkbox" v-model="ticked" class="mt-1 accent-slate-900">
      <span>{{ checkText }}</span>
    </label>
    <div class="flex gap-2">
      <Button size="xs" :disabled="!ticked || busy" @click="$emit('confirm')">
        <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-1.5"></i>{{ confirmLabel }}
      </Button>
      <Button size="xs" variant="outline" :disabled="busy" @click="$emit('cancel')">Cancel</Button>
    </div>
  </div>
</template>

<script>
import { Button } from '@/components/ui/button'
import { level_plural } from '@/lib/isa95-hierarchy.js'

const LIMIT = 5

export default {
  name: 'DuplicateWarning',

  components: { Button },

  emits: ['pick', 'confirm', 'cancel'],

  props: {
    /* From similar_nodes, most devices first. */
    matches: { type: Array, required: true },
    /* The level of the node being added or renamed. */
    level: { type: String, required: true },
    /* 'create' or 'rename'. */
    verb: { type: String, default: 'create' },
    /* The label on each match's button. */
    actionLabel: { type: String, default: 'Use this' },
    compact: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
  },

  data () {
    return { ticked: false, all: false }
  },

  mounted () {
    /* Move focus to the title so the warning is read out, and bring
     * the whole warning into view, so the confirm isn't off screen. */
    this.$refs.title?.focus({ preventScroll: true })
    requestAnimationFrame(() => this.$el?.scrollIntoView?.({ block: 'nearest' }))
  },

  watch: {
    matches () {
      this.ticked = false
      this.all = false
    },
  },

  computed: {
    shown () {
      return this.all ? this.matches : this.matches.slice(0, LIMIT)
    },
    hidden () {
      return this.matches.length - this.shown.length
    },
    listHead () {
      const n = this.matches.length
      return `${n} similar ${n === 1 ? this.level : level_plural(this.level)}`
    },
    checkText () {
      return this.verb === 'rename'
        ? 'These are different places, rename anyway'
        : `These are different places, create a new ${this.level}`
    },
    confirmLabel () {
      return this.verb === 'rename' ? 'Rename' : `Create ${this.level}`
    },
  },

  methods: {
    devices (n) {
      return n === 0 ? 'No devices' : n === 1 ? '1 device' : `${n} devices`
    },
  },
}
</script>
