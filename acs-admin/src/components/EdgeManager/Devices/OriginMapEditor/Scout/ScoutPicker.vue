<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -
  - The address picker a driver's own interface opens with `pick-address`
  - (driver custom UI contract version 2). It is the Manager's picker, over
  - the driver's frame, so the driver's code never sees the scan beyond the
  - one item the operator chooses.
  -->

<template>
  <Dialog :open="open" @update:open="v => { if (!v) $emit('close') }">
    <DialogContent class="sm:max-w-2xl h-[70vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>Choose an address</DialogTitle>
        <DialogDescription>
          The driver's interface asked for an address from the last scan of this connection.
        </DialogDescription>
      </DialogHeader>
      <template v-if="index">
        <input v-model="query" type="search" class="h-8 w-full rounded-md border border-gray-300 px-2 text-xs"
            placeholder="Search names, addresses, descriptions and units" aria-label="Search the scan"/>
        <ScoutTree ref="tree" class="border border-gray-200 bg-white"
            :index="index" :rows="rows" :focus="focus" can-use
            :use-folders="filter?.kind === 'folder'"
            use-title="Choose this address"
            label="Addresses to choose from"
            :empty-text="'Nothing matches.'"
            @toggle="toggle" @focus="id => focus = id"
            @select="choose_if_value" @use="choose"/>
      </template>
      <p v-else class="text-sm text-gray-500">This connection has not been scanned.</p>
      <DialogFooter>
        <Button variant="outline" @click="$emit('close')">Cancel</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import ScoutTree from './ScoutTree.vue'
import { search, visible_rows } from '@/lib/scout/model.js'

export default {
  name: 'ScoutPicker',

  components: { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ScoutTree },

  props: {
    open:   { type: Boolean, default: false },
    index:  { type: Object, default: null },
    /* From the document: `prefix` and `kind`, both optional. */
    filter: { type: Object, default: () => ({}) },
  },

  emits: ['pick', 'close'],

  data () {
    return { query: '', expanded: new Set(), focus: null }
  },

  computed: {
    keep () {
      if (!this.index) return null
      const prefix = this.filter?.prefix
      const kind = this.filter?.kind
      const q = this.query.trim()
      if (!prefix && !kind && !q) return null
      const found = q ? search(this.index, q).matches : null
      const out = new Set()
      for (const it of this.index.items) {
        if (kind && it.kind !== kind) continue
        if (prefix && !(typeof it.address === 'string' && it.address.startsWith(prefix))) continue
        if (found && !found.has(it.id)) continue
        out.add(it.id)
      }
      return out
    },

    rows () {
      return this.index ? visible_rows(this.index, { expanded: this.expanded, keep: this.keep }) : []
    },
  },

  watch: {
    open (v) {
      if (v) {
        this.query = ''
        this.focus = null
        this.$nextTick(() => this.$refs.tree?.focus_tree())
      }
    },
  },

  methods: {
    toggle (id) {
      const next = new Set(this.expanded)
      next.has(id) ? next.delete(id) : next.add(id)
      this.expanded = next
    },

    allowed (item) {
      return item && (!this.filter?.kind || item.kind === this.filter.kind)
    },

    choose_if_value (id) {
      const item = this.index.by_id.get(id)
      if (item?.kind === 'value' && this.allowed(item)) this.$emit('pick', item)
    },

    choose (id) {
      const item = this.index.by_id.get(id)
      if (this.allowed(item)) this.$emit('pick', item)
    },
  },
}
</script>
