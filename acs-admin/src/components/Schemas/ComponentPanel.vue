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

    <!-- The naming pattern is not exposed. It is a regular expression,
         which is beyond this audience, and the library's default covers
         every real case. An existing pattern is still preserved exactly
         and still classifies as breaking if a raw edit changes it. -->
    <div v-if="isList" class="rounded-md border border-slate-200 p-4">
      <div class="text-sm font-medium">There can be more than one</div>
      <p class="mt-1 text-xs leading-relaxed text-gray-500">
        Each one is named on the device that uses this schema, for example
        Spindle_1 and Spindle_2. Letters, digits and underscores.
      </p>
    </div>

    <!-- A real link, opened in a new tab. Following it in place would
         discard whatever is being edited here, and an anchor also gives
         middle-click and cmd-click for free. -->
    <div v-if="targetUuid && targetHref" class="flex gap-2">
      <Button as="a" variant="outline" size="sm" :href="targetHref"
          target="_blank" rel="noopener">
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
    /* Schema UUID to the draft object that will publish it, so an
     * unpublished component can still be opened. */
    draftUuids: { type: Object, default: () => ({}) },
  },

  emits: ['rename', 'pick', 'change'],

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

    /* A draft is addressed by its draft object, a published schema by
     * its own UUID. Resolved through the router so hash history is
     * handled for us. */
    targetHref () {
      if (!this.targetUuid) return null
      const path = this.targetIsDraft
        ? (this.draftUuids[this.targetUuid]
            ? `/schemas/draft/${this.draftUuids[this.targetUuid]}`
            : null)
        : `/schemas/${this.targetUuid}`
      return path ? this.$router.resolve(path).href : null
    },
  },

}
</script>
