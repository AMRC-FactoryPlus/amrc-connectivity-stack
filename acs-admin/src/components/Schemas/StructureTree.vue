<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - The structure panel. This renders the document; it is not the thing
  - being edited.
  -
  - Reserved properties do not appear here. They are lifted into the
  - platform strip above the tree, so everything in the tree is something
  - the user can actually edit.
  -->

<template>
  <div class="flex flex-col gap-px">
    <template v-for="(node, index) in nodes" :key="node.id">
      <div
          class="group flex items-center gap-1 rounded-md px-2 py-1 text-sm cursor-pointer
                 transition-colors"
          :class="rowClass(node)"
          @click="$emit('select', node)">

        <button v-if="expandable(node)"
            class="w-2.5 shrink-0 text-[8px] text-gray-400 hover:text-slate-900"
            :title="isOpen(node) ? 'Collapse' : 'Expand'"
            @click.stop="toggle(node)">
          <i class="fa-solid" :class="isOpen(node) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
        </button>
        <span v-else class="w-2.5 shrink-0"></span>

        <i class="fa-solid fa-fw text-xs shrink-0"
            :class="[glyph(node), presentation(node).colour]"></i>

        <span class="truncate" :class="labelClass(node)">{{ node.key }}</span>

        <!-- A component list carries no count. A schema constrains what
             instances may be named; it does not enumerate them. Only a
             device's origin map knows how many there are. -->
        <span v-if="node.kind === 'componentList'"
            class="shrink-0 text-[10px] text-gray-400">many</span>

        <!-- Trailing slot: the unit for a metric, the kind otherwise.
             The unit is what tells two metrics apart at a glance. -->
        <span class="ml-auto pl-2 shrink-0 text-[10px] truncate max-w-[7rem]"
            :class="trailingClass(node)">
          {{ trailing(node) }}
        </span>

        <!-- Always in the layout, revealed on hover. Showing and hiding
             it changed the row height, so the tree jumped under the
             pointer as you moved down it. -->
        <span v-if="!readonly && node.kind !== 'reserved'"
            class="flex items-center shrink-0 -mr-1 opacity-0 pointer-events-none
                   group-hover:opacity-100 group-hover:pointer-events-auto">
          <button class="h-5 w-5 text-[10px] leading-none text-slate-300 hover:text-slate-700
                         disabled:opacity-30 disabled:hover:text-slate-300"
              title="Move up" :disabled="index === 0"
              @click.stop="$emit('move', { node, delta: -1 })">
            <i class="fa-solid fa-arrow-up"></i>
          </button>
          <button class="h-5 w-5 text-[10px] leading-none text-slate-300 hover:text-slate-700
                         disabled:opacity-30 disabled:hover:text-slate-300"
              title="Move down" :disabled="index === nodes.length - 1"
              @click.stop="$emit('move', { node, delta: 1 })">
            <i class="fa-solid fa-arrow-down"></i>
          </button>
          <button class="h-5 w-5 text-[10px] leading-none text-slate-300 hover:text-red-500"
              title="Remove" @click.stop="$emit('remove', node)">
            <i class="fa-solid fa-trash"></i>
          </button>
        </span>
      </div>

      <div v-if="node.kind === 'group' && isOpen(node)" class="flex">
        <div class="w-[22px] flex justify-center shrink-0">
          <div class="w-px bg-slate-200"></div>
        </div>
        <div class="flex-1 min-w-0">
          <StructureTree
              :nodes="node.children"
              :selected-id="selectedId"
              :readonly="readonly"
              :schema-names="schemaNames"
              @select="e => $emit('select', e)"
              @remove="e => $emit('remove', e)"
              @move="e => $emit('move', e)"/>
          <p v-if="!node.children.length" class="py-1 pl-2 text-xs text-gray-400">
            Empty
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<script>


import { NodeKind } from '@/lib/schema/constants.js'
import { presentationFor } from '@/lib/schema/presentation.js'

export default {
  name: 'StructureTree',



  props: {
    nodes: { type: Array, required: true },
    selectedId: { type: String, default: null },
    readonly: { type: Boolean, default: false },
    /* Maps a schema UUID to its display name, so a component row can say
     * what it points at rather than showing a UUID. */
    schemaNames: { type: Object, default: () => ({}) },
  },

  emits: ['select', 'remove', 'move'],

  data () {
    return { collapsed: new Set() }
  },

  methods: {
    presentation (node) {
      return presentationFor(node.kind)
    },

    expandable (node) {
      return node.kind === NodeKind.GROUP && node.children?.length > 0
    },

    isOpen (node) {
      return !this.collapsed.has(node.id)
    },

    toggle (node) {
      /* Reassigned rather than mutated so Vue sees the change. */
      const next = new Set(this.collapsed)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      this.collapsed = next
    },

    glyph (node) {
      const p = this.presentation(node)
      if (node.kind === NodeKind.GROUP && this.isOpen(node) && node.children?.length)
        return p.openIcon
      return p.icon
    },

    rowClass (node) {
      if (node.id === this.selectedId) return 'bg-slate-200 font-medium'
      if (node.kind === NodeKind.OPAQUE)
        return 'border border-dashed border-slate-300 bg-gray-50 hover:bg-slate-100'
      return 'hover:bg-slate-100'
    },

    labelClass (node) {
      const p = this.presentation(node)
      const classes = []
      if (p.mono) classes.push('font-mono text-[13px]')
      if (p.weight) classes.push(p.weight)
      if (node.kind === NodeKind.OPAQUE) classes.push('text-slate-500')
      return classes.join(' ')
    },

    trailing (node) {
      switch (node.kind) {
        case NodeKind.METRIC:
          return node.fields?.Eng_Unit ?? ''
        case NodeKind.COMPONENT:
        case NodeKind.COMPONENT_LIST:
          return this.schemaNames[node.ref] ?? 'unknown schema'
        case NodeKind.GROUP:
          return this.summarise(node)
        case NodeKind.OPAQUE:
          return 'Not modelled'
        default:
          return ''
      }
    },

    trailingClass (node) {
      if (node.kind === NodeKind.OPAQUE) return 'text-gray-500'
      if (node.kind === NodeKind.METRIC) {
        return node.id === this.selectedId
          ? 'font-mono text-gray-500'
          : 'font-mono text-gray-400'
      }
      return 'text-gray-400'
    },

    /* "3 groups · 9 metrics" tells you what is inside a collapsed group
     * without having to open it. */
    summarise (node) {
      const counts = {}
      const walk = (children) => {
        for (const child of children ?? []) {
          counts[child.kind] = (counts[child.kind] ?? 0) + 1
          if (child.kind === NodeKind.GROUP) walk(child.children)
        }
      }
      walk(node.children)

      const parts = []
      if (counts[NodeKind.GROUP])
        parts.push(`${counts[NodeKind.GROUP]} groups`)
      if (counts[NodeKind.METRIC])
        parts.push(`${counts[NodeKind.METRIC]} metrics`)
      if (!parts.length) return `${node.children?.length ?? 0} items`
      return parts.join(' · ')
    },
  },
}
</script>
