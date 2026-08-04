<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - The schema itself, shown when nothing in the tree is selected.
  -
  - Settings that belong to the whole schema rather than to one node had
  - nowhere to live, and the detail pane was otherwise an empty state
  - telling you to go and click something.
  -->

<template>
  <div class="flex max-w-2xl flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Name</label>
      <Input :model-value="name" :disabled="readonly"
          @update:model-value="v => $emit('update:name', v)"/>
      <p class="text-xs text-gray-500">
        What this schema describes, for example CNC Machine or Robot Arm.
      </p>
    </div>

    <div class="flex items-start justify-between gap-6 rounded-md border
                border-slate-200 p-4">
      <div>
        <div class="text-sm font-medium">A device can use this directly</div>
        <p class="mt-1 text-xs leading-relaxed text-gray-500">
          Machines are built on a top-level schema. Parts of a machine, like an
          axis or a spindle, are used inside another schema instead and are
          hidden when choosing a schema for a device.
        </p>
      </div>
      <Switch class="mt-0.5 shrink-0" :model-value="topLevel" :disabled="readonly"
          @update:model-value="v => $emit('update:topLevel', v)"/>
    </div>

    <div class="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
      <div class="flex items-center justify-between gap-4">
        <span class="text-xs text-gray-500">Schema UUID</span>
        <span class="truncate font-mono text-xs">{{ uuid }}</span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <span class="text-xs text-gray-500">Contents</span>
        <span class="text-xs">{{ summary }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { Input } from '@components/ui/input'
import { Switch } from '@components/ui/switch'

import { NodeKind } from '@/lib/schema/constants.js'

export default {
  name: 'SchemaPanel',

  components: { Input, Switch },

  props: {
    name: { type: String, default: '' },
    uuid: { type: String, default: '' },
    /* Undefined when the schema says nothing about it. The switch shows
     * that as off, and touching it writes an explicit answer. */
    topLevel: { type: Boolean, default: false },
    doc: { type: Object, default: null },
    readonly: { type: Boolean, default: false },
  },

  emits: ['update:name', 'update:topLevel'],

  computed: {
    summary () {
      const counts = {}
      const walk = (children) => {
        for (const child of children ?? []) {
          counts[child.kind] = (counts[child.kind] ?? 0) + 1
          if (child.kind === NodeKind.GROUP) walk(child.children)
        }
      }
      walk(this.doc?.children)

      const parts = []
      if (counts[NodeKind.METRIC]) parts.push(`${counts[NodeKind.METRIC]} metrics`)
      if (counts[NodeKind.COMPONENT] || counts[NodeKind.COMPONENT_LIST]) {
        const n = (counts[NodeKind.COMPONENT] ?? 0)
          + (counts[NodeKind.COMPONENT_LIST] ?? 0)
        parts.push(`${n} ${n === 1 ? 'component' : 'components'}`)
      }
      if (counts[NodeKind.GROUP]) parts.push(`${counts[NodeKind.GROUP]} groups`)
      return parts.length ? parts.join(', ') : 'Empty'
    },
  },
}
</script>
