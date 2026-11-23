<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - Choose a metric's engineering unit from the vocabulary.
  -
  - The value is the Eng_Unit string, as before. Choosing a unit writes
  - its symbol. A string already there that no unit means is kept and
  - shown as not in the vocabulary, so opening a metric changes nothing
  - until a unit is chosen. Units are added on the Units page.
  -->

<template>
  <div class="flex flex-col gap-1">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <button
            type="button"
            :disabled="disabled"
            class="flex h-10 w-full items-center gap-2 rounded-md border border-slate-200 bg-white
                   px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:opacity-50">
          <template v-if="current">
            <span class="font-mono">{{ current }}</span>
            <span v-if="unit" class="truncate text-gray-500">{{ unit.name }}</span>
            <span v-else class="ml-auto shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              Not in the vocabulary
            </span>
          </template>
          <span v-else class="text-slate-500">{{ placeholder }}</span>
          <i class="fa-solid fa-chevron-down text-xs opacity-50" :class="current && !unit ? 'ml-2' : 'ml-auto'"></i>
        </button>
      </PopoverTrigger>

      <PopoverContent class="w-[360px] p-0" align="start">
        <div class="p-2 border-b">
          <Input v-model="search" placeholder="Search units..." class="h-8"/>
        </div>
        <div class="max-h-64 overflow-y-auto py-1">
          <button v-if="current" type="button"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-500 hover:bg-slate-100"
              @click="choose('')">
            No unit
          </button>
          <button v-for="u in matches" :key="u.uuid" type="button"
              class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100"
              @click="choose(u.symbol)">
            <i class="fa-solid fa-check w-3 text-[10px]" :class="{ 'opacity-0': u.uuid !== unit?.uuid }"></i>
            <span class="font-mono font-medium">{{ u.symbol }}</span>
            <span class="truncate">{{ u.name }}</span>
            <span class="font-mono text-xs text-gray-400 ml-auto">{{ u.code }}</span>
          </button>
          <p v-if="!matches.length" class="px-3 py-2 text-sm text-gray-500">
            {{ units.ready ? 'No unit matches.' : 'Loading units...' }}
          </p>
        </div>
        <div class="border-t px-3 py-2 text-xs text-gray-500">
          Missing a unit?
          <RouterLink to="/units" class="underline" @click="open = false">Add it on the Units page</RouterLink>.
        </div>
      </PopoverContent>
    </Popover>
    <p v-if="current && unit && current !== unit.symbol" class="text-xs text-gray-500">
      Written <span class="font-mono">{{ current }}</span>, an alias of
      <span class="font-mono">{{ unit.symbol }}</span>.
    </p>
  </div>
</template>

<script>
import { Input } from '@components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { useEngUnitStore } from '@store/useEngUnitStore.js'

export default {
  name: 'EngUnitPicker',

  components: { Input, Popover, PopoverContent, PopoverTrigger },

  props: {
    modelValue: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
    placeholder: { type: String, default: 'Choose a unit' },
  },

  emits: ['update:modelValue'],

  setup () {
    return { units: useEngUnitStore() }
  },

  data () {
    return { open: false, search: '' }
  },

  mounted () {
    this.units.start()
  },

  computed: {
    current () {
      return (this.modelValue ?? '').trim()
    },
    /* The unit the current string means, if any. */
    unit () {
      return this.current ? this.units.resolve(this.current) ?? null : null
    },
    matches () {
      const t = this.search.trim().toLowerCase()
      const all = [...this.units.data].sort((a, b) => a.symbol.localeCompare(b.symbol))
      if (!t) return all
      return all.filter(u => [u.symbol, u.name, u.code, ...u.aliases]
        .some(s => s.toLowerCase().includes(t)))
    },
  },

  watch: {
    open (o) {
      if (!o) this.search = ''
    },
  },

  methods: {
    choose (symbol) {
      this.$emit('update:modelValue', symbol)
      this.open = false
    },
  },
}
</script>
