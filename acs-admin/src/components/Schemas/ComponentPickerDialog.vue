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
            class="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-gray-50"
            :class="chosen === entry.uuid ? 'bg-gray-100' : ''"
            @click="chosen = entry.uuid">
          <i class="fa-solid fa-fw fa-cube text-gray-400"></i>
          <span class="flex flex-col min-w-0 flex-1">
            <span class="text-sm truncate">{{ entry.label }}</span>
            <span class="text-xs text-gray-400 truncate">{{ entry.uuid }}</span>
          </span>
          <span v-if="entry.isDraft"
              class="text-xs rounded bg-blue-100 text-blue-800 px-1.5 py-0.5">
            Draft
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
import { Button } from '@components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@components/ui/dialog'
import { Input } from '@components/ui/input'
import { Switch } from '@components/ui/switch'

export default {
  name: 'ComponentPickerDialog',

  components: {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter,
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
