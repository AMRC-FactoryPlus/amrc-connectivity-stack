<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - Sparkplug data type selector.
  -
  - Typing is the fast path. The groups keep 28 types legible when
  - browsing, and selected types stay pinned at the bottom of the list so
  - what is already chosen never scrolls out of reach.
  -->

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-baseline justify-between">
      <label class="text-sm font-medium leading-none">Data type</label>
      <span class="text-xs text-gray-500">
        {{ selected.length }} of {{ total }} selected
      </span>
    </div>

    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <button
            type="button"
            :disabled="disabled"
            class="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border
                   border-slate-200 bg-white px-2 py-1.5 text-left
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950
                   focus-visible:ring-offset-2 disabled:opacity-50">
          <span v-for="type in selected" :key="type"
              class="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5
                     text-xs font-medium text-slate-900">
            {{ type }}
            <i class="fa-solid fa-times text-[9px] opacity-50 hover:opacity-100"
                @click.stop="remove(type)"></i>
          </span>
          <span v-if="!selected.length" class="text-sm text-slate-500">
            Choose a type
          </span>
          <span v-else class="inline-flex items-center gap-1 px-1 text-xs text-slate-500">
            <i class="fa-solid fa-plus text-[9px]"></i>Add type
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent class="w-[320px] p-0" align="start">
        <Command :filter-function="filterTypes">
          <CommandInput :placeholder="`Search ${total} types...`"/>
          <CommandList>
            <CommandEmpty>No type matches.</CommandEmpty>

            <CommandGroup v-for="group in unselectedGroups" :key="group.label"
                :heading="group.label">
              <CommandItem v-for="type in group.types" :key="type.name"
                  class="gap-2" :value="type.name" @select="add(type.name)">
                <i class="fa-solid fa-check w-3 text-[10px] opacity-0"></i>
                <span class="font-mono">{{ type.name }}</span>
                <span v-if="type.hint" class="ml-auto text-xs text-gray-400">
                  {{ type.hint }}
                </span>
              </CommandItem>
            </CommandGroup>

            <template v-if="selected.length">
              <CommandSeparator/>
              <CommandGroup heading="Selected">
                <CommandItem v-for="type in selected" :key="type" class="gap-2"
                    :value="type" @select="remove(type)">
                  <i class="fa-solid fa-check w-3 text-[10px]"></i>
                  <span class="font-mono">{{ type }}</span>
                  <span class="ml-auto text-xs text-gray-400">Remove</span>
                </CommandItem>
              </CommandGroup>
            </template>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>

    <p v-if="!selected.length" class="text-xs text-gray-500">
      Pick more than one where a device may report either width.
    </p>
  </div>
</template>

<script>
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
  CommandSeparator,
} from '@components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'

import { TYPE_GROUPS } from '@/lib/schema/presentation.js'

export default {
  name: 'TypeSelector',

  components: {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
    CommandSeparator, Popover, PopoverContent, PopoverTrigger,
  },

  props: {
    modelValue: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
  },

  emits: ['update:modelValue'],

  data () {
    return { open: false }
  },

  computed: {
    selected () {
      return this.modelValue ?? []
    },

    total () {
      return TYPE_GROUPS.reduce((n, g) => n + g.types.length, 0)
    },

    /* Chosen types are shown once, pinned at the bottom, rather than
     * twice in both their group and the selected list. */
    unselectedGroups () {
      return TYPE_GROUPS
        .map(group => ({
          label: group.label,
          types: group.types.filter(t => !this.selected.includes(t.name)),
        }))
        .filter(group => group.types.length)
    },
  },

  methods: {
    /* Substring rather than the default fuzzy match: "int" should not
     * rank Instance ahead of Int8. */
    filterTypes (list, term) {
      if (!term) return list
      const needle = term.toLowerCase()
      return list.filter(item => String(item.value ?? item)
        .toLowerCase().includes(needle))
    },

    add (type) {
      if (this.selected.includes(type)) return
      this.$emit('update:modelValue', [...this.selected, type])
    },

    remove (type) {
      this.$emit('update:modelValue', this.selected.filter(t => t !== type))
    },
  },
}
</script>
