<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="open" @update:open="v => $emit('update:open', v)">
    <DialogContent class="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>Choose a component</DialogTitle>
        <DialogDescription>
          A component is another schema used inside this one.
        </DialogDescription>
      </DialogHeader>

      <Input v-model="search" placeholder="Search schemas"/>

      <div class="max-h-80 overflow-y-auto border rounded-md divide-y">
        <button v-for="entry in results" :key="entry.uuid"
            class="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-100"
            :class="chosen === entry.uuid ? 'bg-slate-100' : ''"
            @click="chosen = entry.uuid">
          <i class="fa-solid fa-fw fa-cube text-slate-700"></i>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-medium">{{ entry.label }}</span>
            <span class="truncate font-mono text-xs text-gray-400">{{ entry.uuid }}</span>
          </span>
          <Badge v-if="entry.isDraft" variant="outline"
              class="shrink-0 gap-1.5 border-dashed font-normal">
            <i class="fa-solid fa-pen text-[8px]"></i>Draft
          </Badge>
          <span v-else-if="entry.origin === 'AMRC library'"
              class="shrink-0 text-xs text-gray-400">
            <i class="fa-solid fa-lock mr-1 text-[9px] text-slate-300"></i>Library
          </span>
        </button>
        <p v-if="!results.length" class="px-3 py-6 text-sm text-gray-400 text-center">
          Nothing matches.
        </p>
      </div>

      <div v-if="!isReplacing" class="flex items-center gap-3">
        <Switch :model-value="asList" @update:model-value="v => asList = v"/>
        <div class="flex flex-col">
          <label class="text-sm font-medium">There can be more than one</label>
          <p class="text-xs text-gray-500">
            Creates a list, so each one is named individually.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="$emit('update:open', false)">Cancel</Button>
        <Button :disabled="!chosen" @click="confirm">Add</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@components/ui/dialog'
import { Input } from '@components/ui/input'
import { Switch } from '@components/ui/switch'

export default {
  name: 'ComponentPickerDialog',

  components: {
    Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle, Input, Switch,
  },

  props: {
    open: { type: Boolean, default: false },
    /* Candidate schemas: {uuid, label, isDraft}. Drafts are offered
     * because a schema may legitimately be built alongside its parts;
     * the publish gate is what stops an unresolvable reference
     * reaching a device. */
    candidates: { type: Array, default: () => [] },
    /* Set when swapping the target of an existing node, in which case
     * the single-or-list decision is already made. */
    isReplacing: { type: Boolean, default: false },
  },

  emits: ['update:open', 'choose'],

  data () {
    return {
      search: '',
      chosen: null,
      asList: false,
    }
  },

  watch: {
    open (value) {
      if (!value) return
      this.search = ''
      this.chosen = null
      this.asList = false
    },
  },

  computed: {
    results () {
      const needle = this.search.trim().toLowerCase()
      if (!needle) return this.candidates
      return this.candidates.filter(c =>
        c.label.toLowerCase().includes(needle) || c.uuid.includes(needle))
    },
  },

  methods: {
    confirm () {
      this.$emit('choose', { ref: this.chosen, asList: this.asList })
      this.$emit('update:open', false)
    },
  },
}
</script>
