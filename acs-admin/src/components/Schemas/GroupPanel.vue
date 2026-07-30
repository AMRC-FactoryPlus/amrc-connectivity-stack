<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="flex max-w-2xl flex-col gap-3.5">
    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Name</label>
      <Input :model-value="node.key" :disabled="readonly"
          @update:model-value="v => $emit('rename', v)"/>
      <p v-if="keyError" class="text-xs text-red-500">{{ keyError }}</p>
    </div>

    <div class="rounded-md border border-slate-200 p-4">
      <div class="text-sm font-medium">{{ summary }}</div>
      <p class="mt-1 text-xs text-gray-500 leading-relaxed">
        A group organises metrics without adding a schema of its own. Use a
        component when the thing inside is a machine part worth naming.
      </p>
    </div>
  </div>
</template>

<script>
import { Input } from '@components/ui/input'

import { NodeKind } from '@/lib/schema/constants.js'

export default {
  name: 'GroupPanel',

  components: { Input },

  props: {
    node: { type: Object, required: true },
    readonly: { type: Boolean, default: false },
    keyError: { type: String, default: null },
  },

  emits: ['rename'],

  computed: {
    summary () {
      const counts = {}
      const walk = (children) => {
        for (const child of children ?? []) {
          counts[child.kind] = (counts[child.kind] ?? 0) + 1
          if (child.kind === NodeKind.GROUP) walk(child.children)
        }
      }
      walk(this.node.children)

      const parts = []
      if (counts[NodeKind.METRIC]) parts.push(`${counts[NodeKind.METRIC]} metrics`)
      if (counts[NodeKind.GROUP]) parts.push(`${counts[NodeKind.GROUP]} groups`)
      if (counts[NodeKind.COMPONENT])
        parts.push(`${counts[NodeKind.COMPONENT]} components`)
      return parts.length ? parts.join(', ') : 'Empty'
    },
  },
}
</script>
