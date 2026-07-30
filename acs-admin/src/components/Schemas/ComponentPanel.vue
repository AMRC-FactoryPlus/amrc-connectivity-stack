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

    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Schema</label>
      <button type="button" :disabled="readonly"
          class="flex h-10 w-full items-center justify-between rounded-md border
                 border-slate-200 bg-white px-3 text-sm disabled:opacity-50
                 hover:bg-slate-50"
          @click="$emit('pick')">
        <span class="flex min-w-0 items-center gap-2">
          <i v-if="targetIsLibrary" class="fa-solid fa-lock text-[10px] text-slate-400"></i>
          <i v-else-if="targetIsDraft" class="fa-solid fa-pen text-[10px] text-slate-400"></i>
          <span class="truncate">{{ targetName }}</span>
          <span v-if="targetOrigin" class="shrink-0 text-xs text-slate-500">
            {{ targetOrigin }}
          </span>
        </span>
        <i class="fa-solid fa-chevron-down text-[10px] opacity-50"></i>
      </button>
      <p class="text-xs text-gray-500">
        A component is another schema used inside this one.
      </p>
      <p v-if="targetIsDraft" class="text-xs text-amber-700">
        Publish {{ targetName }} before publishing this schema.
      </p>
    </div>

    <div v-if="isList" class="flex flex-col gap-1.5">
      <label class="text-sm font-medium leading-none">Instance names</label>
      <Input class="font-mono" :model-value="node.pattern" :disabled="readonly"
          @update:model-value="setPattern"/>
      <p class="text-xs text-gray-500">
        A regular expression constraining what each entry may be called.
      </p>
    </div>

    <div v-if="targetUuid" class="flex gap-2">
      <Button variant="outline" size="sm" @click="$emit('open', targetUuid)">
        <i class="fa-solid fa-arrow-up-right-from-square mr-2"></i>
        Open {{ targetName }}
      </Button>
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
    libraryUuids: { type: Object, default: () => new Set() },
  },

  emits: ['rename', 'pick', 'change', 'open'],

  computed: {
    isList () {
      return this.node.kind === NodeKind.COMPONENT_LIST
    },

    targetUuid () {
      return this.node.ref ?? null
    },

    targetName () {
      return this.schemaNames[this.node.ref] ?? 'Unknown schema'
    },

    targetIsLibrary () {
      return this.libraryUuids.has(this.node.ref)
    },

    targetIsDraft () {
      return !!this.node.ref && !this.publishedUuids.has(this.node.ref)
    },

    targetOrigin () {
      if (this.targetIsDraft) return 'Draft'
      if (this.targetIsLibrary) return 'AMRC library'
      return 'Local'
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
