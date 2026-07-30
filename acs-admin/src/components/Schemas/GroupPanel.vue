<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <div class="flex flex-col gap-5 max-w-2xl">
    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium">Name</label>
      <Input :model-value="node.key" :disabled="readonly"
          @update:model-value="v => $emit('rename', v)"/>
      <p v-if="keyError" class="text-xs text-red-500">{{ keyError }}</p>
    </div>

    <div class="rounded-md border p-4">
      <div class="text-sm font-medium">{{ node.children.length }} items</div>
      <p class="text-xs text-gray-500 mt-1">
        A group organises metrics without adding a schema of its own. Use a
        component when the thing inside is a machine part worth naming.
      </p>
    </div>
  </div>
</template>

<script>
import { Input } from '@components/ui/input'

export default {
  name: 'GroupPanel',

  components: { Input },

  props: {
    node: { type: Object, required: true },
    readonly: { type: Boolean, default: false },
    keyError: { type: String, default: null },
  },

  emits: ['rename'],
}
</script>
