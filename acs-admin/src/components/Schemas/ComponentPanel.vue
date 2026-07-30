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

    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium">Component</label>
      <div class="flex items-center gap-2">
        <div class="flex-1 rounded-md border px-3 py-2">
          <div class="text-sm">{{ targetName }}</div>
          <div class="text-xs text-gray-400">{{ node.ref }}</div>
        </div>
        <Button variant="outline" :disabled="readonly" @click="$emit('pick')">
          Change
        </Button>
      </div>
      <p class="text-xs text-gray-500">
        A component is another schema used inside this one.
      </p>
      <p v-if="!targetPublished" class="text-xs text-amber-600">
        This component is still a draft. Publish it before publishing this schema.
      </p>
    </div>

    <div v-if="isList" class="flex flex-col gap-2">
      <label class="text-sm font-medium">Instance names</label>
      <Input :model-value="node.pattern" :disabled="readonly"
          @update:model-value="v => setPattern(v)"/>
      <p class="text-xs text-gray-500">
        A regular expression constraining what each entry may be called.
        The library default allows letters, digits and underscores.
      </p>
    </div>
  </div>
</template>

<script>
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'

import { NodeKind } from '@/lib/schema/constants.js'

export default {
  name: 'ComponentPanel',

  components: { Button, Input },

  props: {
    node: { type: Object, required: true },
    readonly: { type: Boolean, default: false },
    keyError: { type: String, default: null },
    schemaNames: { type: Object, default: () => ({}) },
    publishedUuids: { type: Object, default: () => new Set() },
  },

  emits: ['rename', 'pick', 'change'],

  computed: {
    isList () {
      return this.node.kind === NodeKind.COMPONENT_LIST
    },

    targetName () {
      return this.schemaNames[this.node.ref] ?? 'Unknown schema'
    },

    targetPublished () {
      return this.publishedUuids.has(this.node.ref)
    },
  },

  methods: {
    setPattern (value) {
      this.node.pattern = value
      this.$emit('change')
    },
  },
}
</script>
