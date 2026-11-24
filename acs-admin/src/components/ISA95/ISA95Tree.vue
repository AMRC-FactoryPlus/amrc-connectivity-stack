<!--
  - ACS Admin
  - The ISA-95 hierarchy as a tree, with inline add and rename.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <div class="flex flex-col min-h-0 flex-1 rounded-md border border-slate-200 bg-white">
    <div class="flex items-center h-9 px-3 border-b border-slate-200 text-xs text-slate-500">
      <span class="pl-8">Node</span>
      <span class="ml-auto">Devices, including below</span>
    </div>

    <div ref="tree"
        class="flex-1 overflow-y-auto p-1 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500"
        role="tree" aria-label="ISA-95 hierarchy"
        :tabindex="rows.length ? 0 : -1"
        :aria-activedescendant="focusKey ? rowId(focusKey) : undefined"
        @keydown="onKey"
        @focus="onFocus">

      <!-- A new Enterprise goes at the top. -->
      <template v-if="edit && edit.mode === 'add' && !edit.parent">
        <EditRow :edit="edit" :depth="0" @save="save" @cancel="cancel"/>
        <WarningRow v-if="edit.matches" :edit="edit" :depth="0" @pick="pick" @confirm="save(true)" @cancel="cancel"/>
      </template>

      <div v-if="!rows.length && query" class="flex flex-col items-center gap-2 py-16 text-sm text-slate-500">
        <i class="fa-solid fa-magnifying-glass text-xl text-slate-400"></i>
        <div class="font-medium text-slate-700">No node matches "{{ query }}"</div>
        <div>The search looks at names and aliases at every level.</div>
        <Button size="xs" variant="outline" @click="$emit('clear-search')">Clear search</Button>
      </div>

      <template v-for="r in rows" :key="r.key">
        <EditRow v-if="edit && edit.mode === 'rename' && edit.key === r.key"
            :edit="edit" :depth="r.depth" @save="save" @cancel="cancel"/>
        <div v-else
            :id="rowId(r.key)"
            role="treeitem"
            :aria-level="r.depth + 1"
            :aria-selected="r.key === selectedKey"
            :aria-expanded="r.hasKids ? r.expanded : undefined"
            :aria-label="ariaLabel(r)"
            class="group flex items-center gap-2 h-[34px] pr-2 rounded-md cursor-pointer select-none mb-px"
            :class="[
              r.key === selectedKey ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100',
              r.key === focusKey && treeFocused ? 'ring-1 ring-inset ring-blue-500' : '',
            ]"
            :style="{ paddingLeft: `${8 + r.depth * 20}px` }"
            @click="select(r)"
            @dblclick="r.hasKids && $emit('toggle', r.key)">
          <button type="button" tabindex="-1" class="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-900 shrink-0"
              :class="{ invisible: !r.hasKids }" :aria-hidden="true"
              @click.stop="$emit('toggle', r.key)">
            <i class="fa-solid fa-xs" :class="r.expanded ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          </button>
          <span class="w-20 shrink-0 text-center text-[10px] uppercase tracking-wide text-slate-500 border border-slate-200 rounded bg-white font-normal">{{ node(r).level }}</span>
          <span class="truncate">
            <template v-if="hl(r)">{{ hl(r).pre }}<mark class="bg-yellow-200 rounded-sm">{{ hl(r).mid }}</mark>{{ hl(r).post }}</template>
            <template v-else>{{ node(r).name }}</template>
          </span>
          <span v-if="flags.has(r.uuid)"
              class="shrink-0 inline-flex items-center gap-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-300 rounded px-1.5 font-normal"
              :title="`Looks like ${nameOf(flags.get(r.uuid))}`">
            <i class="fa-solid fa-triangle-exclamation text-[10px]"></i>possible duplicate
          </span>
          <span v-if="r.also.length" class="shrink-0 text-[11px] italic text-slate-500 font-normal truncate">also under {{ r.also.join(', ') }}</span>

          <span class="ml-auto"></span>
          <span v-if="canEdit" class="hidden gap-0.5 group-hover:inline-flex" :class="{ '!inline-flex': r.key === selectedKey }">
            <button v-if="childLevel(r) && canCreate(childLevel(r))" type="button" tabindex="-1"
                class="h-[26px] px-1.5 rounded text-xs text-slate-600 hover:bg-white hover:text-slate-900 font-normal"
                :title="`Add ${article(childLevel(r))} under ${node(r).name}`"
                @click.stop="startAdd(r)">
              <i class="fa-solid fa-plus fa-xs mr-1"></i>{{ childLevel(r) }}
            </button>
            <button type="button" tabindex="-1" class="w-[26px] h-[26px] rounded text-slate-500 hover:bg-white hover:text-slate-900"
                aria-label="Rename" title="Rename" @click.stop="startRename(r)">
              <i class="fa-solid fa-pen fa-xs"></i>
            </button>
            <button v-if="node(r).level !== 'Enterprise'" type="button" tabindex="-1"
                class="w-[26px] h-[26px] rounded text-slate-500 hover:bg-white hover:text-slate-900"
                aria-label="Move to..." title="Move to..." @click.stop="$emit('move', r)">
              <i class="fa-solid fa-arrows-up-down-left-right fa-xs"></i>
            </button>
            <button v-if="canDelete(r.uuid)" type="button" tabindex="-1"
                class="w-[26px] h-[26px] rounded text-slate-500 hover:bg-white hover:text-slate-900"
                aria-label="Merge into..." title="Merge into..." @click.stop="$emit('merge', r.uuid)">
              <i class="fa-solid fa-code-merge fa-xs"></i>
            </button>
          </span>
          <span class="w-12 shrink-0 text-right text-xs text-slate-500 tabular-nums font-normal">{{ counts.get(r.uuid)?.total ?? 0 }}</span>
        </div>

        <template v-if="edit && edit.key === r.key">
          <EditRow v-if="edit.mode === 'add'" :edit="edit" :depth="r.depth + 1" @save="save" @cancel="cancel"/>
          <WarningRow v-if="edit.matches" :edit="edit" :depth="edit.mode === 'add' ? r.depth + 1 : r.depth"
              @pick="pick" @confirm="save(true)" @cancel="cancel"/>
        </template>
      </template>
    </div>

    <div class="flex items-center gap-4 h-9 px-3 border-t border-slate-200 text-xs text-slate-500">
      <span>{{ plural(vocab.nodes.size, 'node') }}</span>
      <span>{{ plural(deviceTotal, 'device') }} placed</span>
      <span v-if="flaggedCount" class="text-amber-700">
        <i class="fa-solid fa-triangle-exclamation mr-1"></i>{{ plural(flaggedCount, 'possible duplicate') }}
      </span>
    </div>
  </div>
</template>

<script>
import { h, nextTick } from 'vue'
import { toast } from 'vue-sonner'
import { isa95_value_problem } from '@amrc-factoryplus/service-client'

import { Button } from '@/components/ui/button'
import DuplicateWarning from '@/components/ISA95/DuplicateWarning.vue'
import { ISA95_LEVEL_CLASSES } from '@/store/useISA95Store.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {
  child_level, create_node, highlight, level_with_article, rename_node,
  similar_nodes,
} from '@/lib/isa95-hierarchy.js'

/* The inline name field, used for both add and rename. */
const EditRow = {
  props: ['edit', 'depth'],
  emits: ['save', 'cancel'],
  mounted () {
    const input = this.$refs.input
    input?.focus()
    if (this.edit.mode === 'rename') input?.select()
  },
  render () {
    const e = this.edit
    return h('div', {
      class: 'flex items-center gap-2 h-[38px] pr-2 rounded-md bg-slate-50 mb-px',
      style: { paddingLeft: `${8 + this.depth * 20 + 28}px` },
    }, [
      h('span', { class: 'w-20 shrink-0 text-center text-[10px] uppercase tracking-wide text-slate-500 border border-slate-200 rounded bg-white' }, e.level),
      h('input', {
        ref: 'input',
        class: 'h-7 flex-1 min-w-0 rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-900',
        value: e.value,
        disabled: e.busy,
        placeholder: e.mode === 'add' ? `New ${e.level} name` : '',
        'aria-label': e.mode === 'add' ? `Name of the new ${e.level}` : `New name for ${e.original}`,
        onInput: ev => { e.value = ev.target.value; e.matches = null; e.error = null },
        onKeydown: ev => {
          ev.stopPropagation()
          if (ev.key === 'Enter') { ev.preventDefault(); this.$emit('save', false) }
          if (ev.key === 'Escape') { ev.preventDefault(); this.$emit('cancel') }
        },
      }),
      h(Button, { size: 'xs', disabled: e.busy || !!e.matches, onClick: () => this.$emit('save', false) },
        () => e.mode === 'add' ? 'Add' : 'Save'),
      h(Button, { size: 'xs', variant: 'ghost', disabled: e.busy, onClick: () => this.$emit('cancel') }, () => 'Cancel'),
      e.error
        ? h('span', { class: 'text-xs text-red-600 truncate', role: 'alert' }, e.error)
        : h('span', { class: 'text-xs text-slate-400 truncate hidden lg:inline' }, 'Enter saves, Escape cancels'),
    ])
  },
}

/* The duplicate warning, indented under the row it belongs to. */
const WarningRow = {
  props: ['edit', 'depth'],
  emits: ['pick', 'confirm', 'cancel'],
  render () {
    const e = this.edit
    return h('div', { class: 'py-1 pr-2', style: { paddingLeft: `${8 + this.depth * 20 + 28}px` } }, [
      h('div', { class: 'max-w-[600px]' }, [
        h(DuplicateWarning, {
          matches: e.matches,
          level: e.level,
          verb: e.mode === 'rename' ? 'rename' : 'create',
          actionLabel: e.mode === 'rename' ? 'Merge into this...' : 'Show this',
          compact: true,
          busy: e.busy,
          onPick: u => this.$emit('pick', u),
          onConfirm: () => this.$emit('confirm'),
          onCancel: () => this.$emit('cancel'),
        }),
      ]),
    ])
  },
}

export default {
  name: 'ISA95Tree',

  components: { Button, EditRow, WarningRow },

  emits: ['select', 'toggle', 'open', 'move', 'merge', 'reveal', 'clear-search', 'expand-under'],

  props: {
    vocab: { type: Object, required: true },
    /* From tree_rows. */
    rows: { type: Array, required: true },
    /* From device_counts. */
    counts: { type: Map, required: true },
    /* From duplicate_flags. */
    flags: { type: Map, required: true },
    query: { type: String, default: '' },
    selectedKey: { type: String, default: null },
    canEdit: { type: Boolean, default: false },
    canCreate: { type: Function, default: () => false },
    canDelete: { type: Function, default: () => false },
  },

  setup () {
    return { s: useServiceClientStore() }
  },

  data () {
    return {
      /* The inline add or rename in progress:
       * { mode, key, parent, uuid, level, value, original, matches, busy, error } */
      edit: null,
      focusKey: null,
      treeFocused: false,
      typeahead: '',
      typeaheadAt: 0,
    }
  },

  mounted () {
    this.$refs.tree.addEventListener('blur', () => { this.treeFocused = false })
  },

  computed: {
    deviceTotal () {
      let n = 0
      for (const [uuid, c] of this.counts)
        if (!this.vocab.parents.get(uuid)?.length) n += c.total
      return n
    },
    flaggedCount () {
      return this.flags.size
    },
  },

  watch: {
    selectedKey (k) {
      if (k) this.focusKey = k
    },
  },

  methods: {
    node (r) {
      return this.vocab.nodes.get(r.uuid)
    },
    nameOf (uuid) {
      return this.vocab.nodes.get(uuid)?.name ?? uuid
    },
    childLevel (r) {
      return child_level(this.node(r).level)
    },
    article: level_with_article,
    hl (r) {
      return highlight(this.node(r).name, this.query)
    },
    rowId (key) {
      return `isa95-row-${key.replace(/[^a-zA-Z0-9-]/g, '_')}`
    },
    plural (n, word) {
      return `${n} ${word}${n === 1 ? '' : 's'}`
    },
    ariaLabel (r) {
      const n = this.node(r)
      const c = this.counts.get(r.uuid)?.total ?? 0
      return [
        n.name, n.level, this.plural(c, 'device'),
        this.flags.has(r.uuid) ? 'possible duplicate' : null,
        r.also.length ? `also under ${r.also.join(', ')}` : null,
      ].filter(Boolean).join(', ')
    },

    select (r) {
      this.focusKey = r.key
      this.$emit('select', r)
    },

    /* Public: start adding a node under a row, or an Enterprise at the
     * top with no row. */
    startAdd (r) {
      if (!r) {
        this.edit = this.newEdit({ mode: 'add', key: null, parent: null, level: 'Enterprise' })
        return
      }
      const level = this.childLevel(r)
      if (!level) return
      if (r.hasKids && !r.expanded) this.$emit('open', r.key)
      this.edit = this.newEdit({ mode: 'add', key: r.key, parent: r.uuid, level })
    },

    /* Public: start renaming a row. */
    startRename (r) {
      const n = this.node(r)
      this.edit = this.newEdit({
        mode: 'rename', key: r.key, uuid: r.uuid, level: n.level, value: n.name, original: n.name,
      })
    },

    newEdit (e) {
      return { value: '', original: '', matches: null, busy: false, error: null, ...e }
    },

    cancel () {
      const key = this.edit?.key
      this.edit = null
      nextTick(() => {
        if (key) this.focusKey = key
        this.$refs.tree?.focus()
      })
    },

    /* Check the name, run the duplicate check, then write. With
     * `confirmed` the warning has been ticked through. */
    async save (confirmed) {
      const e = this.edit
      if (!e || e.busy) return
      const name = e.value.trim()
      if (!name) { e.error = 'Enter a name'; return }
      if (e.mode === 'rename' && name === e.original) { this.cancel(); return }
      const problem = isa95_value_problem(name)
      if (problem) { e.error = `This name ${problem}`; return }

      if (!confirmed) {
        const matches = similar_nodes(this.vocab, {
          level: e.level, name, exclude: e.uuid, counts: this.counts,
        })
        if (matches.length) { e.matches = matches; return }
      }

      e.busy = true
      try {
        const cdb = this.s.client.ConfigDB
        if (e.mode === 'add') {
          const uuid = await create_node(cdb, this.vocab, {
            level: e.level, name, parent: e.parent, class_uuid: ISA95_LEVEL_CLASSES[e.level],
          })
          toast.success(`Added ${e.level} "${name}"`)
          this.edit = null
          this.$emit('reveal', uuid)
        }
        else {
          await rename_node(cdb, e.uuid, name)
          toast.success(`Renamed ${e.original} to ${name}`)
          this.edit = null
        }
        nextTick(() => this.$refs.tree?.focus())
      }
      catch (err) {
        console.error('Failed to save node:', err)
        e.busy = false
        e.error = err.message || 'Saving failed'
      }
    },

    /* A match was picked in the warning: on add, show that node instead;
     * on rename, merge into it. */
    pick (uuid) {
      const e = this.edit
      this.edit = null
      if (e.mode === 'rename') this.$emit('merge', e.uuid, uuid)
      else this.$emit('reveal', uuid)
    },

    onFocus () {
      this.treeFocused = true
      if (!this.focusKey || !this.rows.some(r => r.key === this.focusKey))
        this.focusKey = this.selectedKey ?? this.rows[0]?.key ?? null
    },

    focusRow (r) {
      if (!r) return
      this.select(r)
      nextTick(() => document.getElementById(this.rowId(r.key))?.scrollIntoView({ block: 'nearest' }))
    },

    /* The ARIA tree pattern. */
    onKey (ev) {
      if (this.edit || !this.rows.length) return
      const ix = this.rows.findIndex(r => r.key === this.focusKey)
      const r = this.rows[ix]
      const go = (fn) => { ev.preventDefault(); fn() }
      switch (ev.key) {
        case 'ArrowDown': return go(() => this.focusRow(this.rows[Math.min(ix + 1, this.rows.length - 1)]))
        case 'ArrowUp': return go(() => this.focusRow(this.rows[Math.max(ix - 1, 0)]))
        case 'Home': return go(() => this.focusRow(this.rows[0]))
        case 'End': return go(() => this.focusRow(this.rows.at(-1)))
        case 'ArrowRight': return go(() => {
          if (!r?.hasKids) return
          if (!r.expanded) this.$emit('toggle', r.key)
          else this.focusRow(this.rows[ix + 1])
        })
        case 'ArrowLeft': return go(() => {
          if (!r) return
          if (r.expanded) this.$emit('toggle', r.key)
          else this.focusRow(this.rows.slice(0, ix).reverse().find(x => x.depth === r.depth - 1))
        })
        case '*': return go(() => r && this.$emit('expand-under', r.key))
        case 'F2': return go(() => r && this.canEdit && this.startRename(r))
        case 'Enter': return go(() => {
          if (!r || !this.canEdit) return
          if (ev.shiftKey) {
            const level = this.childLevel(r)
            if (level && this.canCreate(level)) this.startAdd(r)
          }
          else this.startRename(r)
        })
      }
      /* Type to jump to the next name starting with the letters typed. */
      if (ev.key.length === 1 && /\S/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const now = Date.now()
        this.typeahead = (now - this.typeaheadAt < 700 ? this.typeahead : '') + ev.key.toLowerCase()
        this.typeaheadAt = now
        const order = [...this.rows.slice(ix + 1), ...this.rows.slice(0, ix + 1)]
        const hit = order.find(x => this.node(x).name.toLowerCase().startsWith(this.typeahead))
        if (hit) { ev.preventDefault(); this.focusRow(hit) }
      }
    },
  },
}
</script>
