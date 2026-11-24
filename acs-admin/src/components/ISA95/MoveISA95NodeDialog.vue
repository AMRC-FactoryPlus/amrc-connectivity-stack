<!--
  - ACS Admin
  - Move an ISA-95 node to a new parent.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <Dialog :open="isOpen && !!node" @update:open="handleOpen">
    <DialogContent v-if="node" class="sm:max-w-[520px]" @open-auto-focus="focusSearch">
      <DialogHeader>
        <DialogTitle>Move {{ node.name }} to...</DialogTitle>
        <DialogDescription>
          Only {{ plural(parentLevel) }} can hold {{ article(node.level) }}, so only {{ plural(parentLevel) }} are listed.
          Devices placed on {{ node.name }} or below it move with it.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-2">
        <div class="relative">
          <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"></i>
          <Input ref="search" v-model="q" class="pl-8" :placeholder="`Search ${plural(parentLevel)}...`"
              :aria-label="`Search ${plural(parentLevel)}`" @keydown="onKey"/>
        </div>
        <div class="max-h-72 overflow-y-auto rounded-md border border-slate-200 p-1" role="listbox" :aria-label="`${plural(parentLevel)}`">
          <div v-if="!shown.length" class="px-3 py-6 text-center text-sm text-slate-500">
            No {{ parentLevel }} matches "{{ q }}"
          </div>
          <button v-for="(t, i) in shown" :key="t.uuid" type="button" role="option"
              :aria-selected="t.uuid === target"
              :disabled="t.uuid === from"
              class="w-full flex items-center gap-2 text-left rounded px-2.5 py-1.5 disabled:opacity-50 disabled:cursor-default"
              :class="t.uuid === target ? 'bg-slate-200' : i === cursor ? 'bg-slate-100' : 'hover:bg-slate-100'"
              @click="target = t.uuid">
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium truncate">{{ t.name }}</span>
              <span v-if="t.path" class="block text-xs text-slate-500 truncate">{{ t.path }}</span>
            </span>
            <span v-if="t.uuid === from" class="text-[11px] text-slate-500 border border-slate-200 rounded px-1.5">current</span>
            <span v-else-if="t.current" class="text-[11px] text-slate-500 border border-slate-200 rounded px-1.5">also a parent</span>
          </button>
        </div>
        <p v-if="summary" class="text-xs text-slate-500">{{ summary }}</p>
        <p v-if="plan?.error" class="text-xs text-red-600">{{ plan.error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="handleOpen(false)">Cancel</Button>
        <Button :disabled="!canApply || busy" @click="apply">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>Move here
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { toast } from 'vue-sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useISA95Store } from '@/store/useISA95Store.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {
  apply_vocabulary_steps, level_plural, level_with_article, move_targets,
  node_matches, parent_level, plan_move,
} from '@/lib/isa95-hierarchy.js'

export default {
  name: 'MoveISA95NodeDialog',

  components: { Button, Input, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle },

  setup () {
    return { isa95: useISA95Store(), s: useServiceClientStore() }
  },

  data () {
    return { isOpen: false, busy: false, uuid: null, from: null, target: null, q: '', cursor: 0 }
  },

  mounted () {
    /* The payload is `{ node, from }`: `from` is the parent the node is
     * being moved away from, which matters for a node with two. */
    window.events.on('show-isa95-move-dialog', ({ node, from }) => {
      this.uuid = node?.uuid ?? null
      this.from = from ?? this.isa95.vocabulary.parents.get(this.uuid)?.[0] ?? null
      this.target = null
      this.q = ''
      this.cursor = 0
      this.isOpen = true
    })
  },

  computed: {
    vocab () {
      return this.isa95.vocabulary
    },
    node () {
      return this.uuid ? this.vocab.nodes.get(this.uuid) ?? null : null
    },
    parentLevel () {
      return parent_level(this.node?.level) ?? ''
    },
    shown () {
      if (!this.node) return []
      return move_targets(this.vocab, this.uuid)
        .filter(t => node_matches(this.vocab.nodes.get(t.uuid), this.q) || t.path.toLowerCase().includes(this.q.trim().toLowerCase()))
    },
    plan () {
      if (!this.target) return null
      return plan_move(this.vocab, this.uuid, this.from, this.target)
    },
    canApply () {
      return !!this.plan?.steps?.length
    },
    summary () {
      if (!this.target || this.plan?.error) return ''
      const to = this.vocab.nodes.get(this.target)?.name
      const from = this.from && this.vocab.nodes.get(this.from)?.name
      const others = (this.vocab.parents.get(this.uuid) ?? []).filter(p => p !== this.from && p !== this.target)
      let s = from ? `${to} replaces ${from}.` : `${this.node.name} goes under ${to}.`
      if (others.length)
        s += ` ${others.map(p => this.vocab.nodes.get(p)?.name).join(', ')} stays a parent.`
      return s
    },
  },

  watch: {
    q () {
      this.cursor = 0
    },
  },

  methods: {
    plural: level_plural,
    article: level_with_article,

    handleOpen (open) {
      if (this.busy) return
      this.isOpen = open
      if (!open) this.uuid = null
    },

    /* Start in the search, not on the close button. */
    focusSearch (ev) {
      ev.preventDefault()
      const el = this.$refs.search?.$el
      ;(el?.querySelector?.('input') ?? el)?.focus?.()
    },

    onKey (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); this.cursor = Math.min(this.cursor + 1, this.shown.length - 1) }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); this.cursor = Math.max(this.cursor - 1, 0) }
      if (ev.key === 'Enter') {
        ev.preventDefault()
        const t = this.shown[this.cursor]
        if (t && t.uuid !== this.from) this.target = t.uuid
      }
    },

    async apply () {
      const name = this.node.name
      const to = this.vocab.nodes.get(this.target)?.name
      this.busy = true
      try {
        await apply_vocabulary_steps(this.s.client.ConfigDB, this.plan.steps)
        toast.success(`Moved ${name} under ${to}`)
        window.events.emit('isa95-node-moved', { uuid: this.uuid, to: this.target })
        this.isOpen = false
        this.uuid = null
      }
      catch (err) {
        console.error('Failed to move node:', err)
        toast.error(`Failed to move ${name}`, { description: err.message || 'An unexpected error occurred' })
      }
      finally {
        this.busy = false
      }
    },
  },
}
</script>
