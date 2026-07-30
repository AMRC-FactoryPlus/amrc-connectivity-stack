<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - The structure panel. This renders the document; it is not the thing
  - being edited. Every row names what it is in the composer's terms, so
  - the JSON Schema constructs underneath never surface.
  -->

<template>
  <div class="flex flex-col gap-1">
    <div v-for="(node, index) in nodes" :key="node.id">
      <div
          class="group flex items-center gap-2 rounded-md border px-2 py-1.5 text-left w-full"
          :class="rowClass(node)"
          @click="$emit('select', node)">
        <button
            v-if="node.kind === 'group'"
            class="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 shrink-0"
            :title="collapsed.has(node.id) ? 'Expand' : 'Collapse'"
            @click.stop="toggle(node)">
          <i class="fa-solid fa-fw text-xs"
              :class="collapsed.has(node.id) ? 'fa-chevron-right' : 'fa-chevron-down'"></i>
        </button>
        <span v-else class="w-5 shrink-0"></span>

        <span
            class="w-7 h-7 shrink-0 flex items-center justify-center rounded bg-gray-100"
            :title="describe(node)">
          <i class="fa-solid fa-fw text-xs" :class="icon(node)"></i>
        </span>

        <span class="flex flex-col min-w-0 flex-1">
          <span class="truncate text-sm" :class="node.kind === 'reserved' ? 'text-gray-500' : ''">
            {{ node.key }}
          </span>
          <span class="truncate text-xs text-gray-400">{{ subtitle(node) }}</span>
        </span>

        <span v-if="!readonly && node.kind !== 'reserved'"
            class="flex items-center opacity-0 group-hover:opacity-100 shrink-0">
          <button class="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-gray-700"
              title="Move up" :disabled="index === 0"
              @click.stop="$emit('move', { node, delta: -1 })">
            <i class="fa-solid fa-arrow-up text-xs"></i>
          </button>
          <button class="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-gray-700"
              title="Move down" :disabled="index === nodes.length - 1"
              @click.stop="$emit('move', { node, delta: 1 })">
            <i class="fa-solid fa-arrow-down text-xs"></i>
          </button>
          <button class="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-500"
              title="Remove" @click.stop="$emit('remove', node)">
            <i class="fa-solid fa-trash text-xs"></i>
          </button>
        </span>
      </div>

      <div v-if="node.kind === 'group' && !collapsed.has(node.id)" class="ml-6 mt-1 border-l pl-2">
        <StructureTree
            :nodes="node.children"
            :selected-id="selectedId"
            :readonly="readonly"
            :schema-names="schemaNames"
            @select="e => $emit('select', e)"
            @remove="e => $emit('remove', e)"
            @move="e => $emit('move', e)"/>
        <p v-if="!node.children.length" class="text-xs text-gray-400 py-1 pl-2">
          Empty
        </p>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'StructureTree',

  props: {
    nodes: { type: Array, required: true },
    selectedId: { type: String, default: null },
    readonly: { type: Boolean, default: false },
    /* Maps a schema UUID to its display name, so a component row can
     * say what it points at rather than showing a UUID. */
    schemaNames: { type: Object, default: () => ({}) },
  },

  emits: ['select', 'remove', 'move'],

  data () {
    return {
      collapsed: new Set(),
    }
  },

  methods: {
    toggle (node) {
      /* Reassigned rather than mutated so Vue sees the change. */
      const next = new Set(this.collapsed)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      this.collapsed = next
    },

    rowClass (node) {
      if (node.id === this.selectedId) return 'bg-gray-100 border-gray-300'
      if (node.kind === 'reserved') return 'border-transparent bg-gray-50/60'
      return 'border-transparent hover:bg-gray-50 cursor-pointer'
    },

    icon (node) {
      switch (node.kind) {
        case 'metric': return 'fa-gauge'
        case 'component': return 'fa-cube'
        case 'componentList': return 'fa-cubes'
        case 'group': return 'fa-folder'
        case 'reserved': return 'fa-lock'
        default: return 'fa-code'
      }
    },

    describe (node) {
      switch (node.kind) {
        case 'metric': return 'Metric'
        case 'component': return 'Component'
        case 'componentList': return 'Component list'
        case 'group': return 'Group'
        case 'reserved': return 'Set by Factory+'
        default: return 'Raw schema'
      }
    },

    subtitle (node) {
      switch (node.kind) {
        case 'metric':
          return (node.fields?.Sparkplug_Type ?? []).join(', ') || 'No type set'
        case 'component':
          return this.schemaNames[node.ref] ?? node.ref
        case 'componentList':
          return `Many ${this.schemaNames[node.ref] ?? node.ref}`
        case 'group':
          return `${node.children?.length ?? 0} items`
        case 'reserved':
          return 'Set by Factory+'
        default:
          /* Named honestly rather than hidden. An opaque node is a part
           * of the schema the composer does not model; it is preserved
           * exactly, and the raw view shows what it holds. */
          return 'Not editable here'
      }
    },
  },
}
</script>
