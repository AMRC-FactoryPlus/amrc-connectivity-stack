<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - The publish gate.
  -
  - Whether publishing updates in place or forks to a new version is
  - decided by the classifier, not by the author. This screen explains
  - the decision; it does not offer it as a choice.
  -->

<template>
  <Dialog :open="open" @update:open="v => $emit('update:open', v)">
    <DialogContent class="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Publish {{ name }}</DialogTitle>
        <DialogDescription>{{ outcomeLine }}</DialogDescription>
      </DialogHeader>

      <!-- Blocked: a referenced component is still a draft. Publishing
           would emit a reference no consumer can resolve. -->
      <div v-if="unresolved.length" class="rounded-md border border-amber-300 bg-amber-50 p-3">
        <div class="flex items-start gap-2">
          <i class="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5"></i>
          <div class="text-sm">
            <p class="font-medium">This schema uses components that are still drafts.</p>
            <ul class="mt-1 list-disc list-inside text-amber-900">
              <li v-for="ref in unresolved" :key="ref">
                Publish {{ nameFor(ref) }} before publishing this schema.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <template v-else>
        <!-- Changes -->
        <div v-if="breakingChanges.length" class="flex flex-col gap-2">
          <div class="text-sm font-medium">Breaking changes</div>
          <ul class="rounded-md border divide-y">
            <li v-for="(change, i) in breakingChanges" :key="`b${i}`"
                class="flex items-start gap-2 px-3 py-2 text-sm">
              <i class="fa-solid fa-circle-exclamation text-red-500 mt-0.5"></i>
              <span>{{ change.summary }}</span>
            </li>
          </ul>
        </div>

        <div v-if="additiveChanges.length" class="flex flex-col gap-2">
          <div class="text-sm font-medium">Safe changes</div>
          <ul class="rounded-md border divide-y">
            <li v-for="(change, i) in additiveChanges" :key="`a${i}`"
                class="flex items-start gap-2 px-3 py-2 text-sm">
              <i class="fa-solid fa-circle-plus text-emerald-500 mt-0.5"></i>
              <span>{{ change.summary }}</span>
            </li>
          </ul>
        </div>

        <p v-if="!changes.length && basedOn" class="text-sm text-gray-500">
          Nothing has changed since this schema was last published.
        </p>

        <!-- Reach -->
        <div class="rounded-md border p-3 flex flex-col gap-1.5">
          <div class="text-sm font-medium">Who this reaches</div>
          <div class="text-sm text-gray-600">{{ configuredLine }}</div>
          <div class="text-sm text-gray-600">{{ publishingLine }}</div>
          <div v-if="referencedBy.length" class="text-sm text-gray-600">
            {{ referencedLine }}
          </div>
        </div>
      </template>

      <DialogFooter>
        <Button variant="outline" @click="$emit('update:open', false)">Cancel</Button>
        <Button
            :disabled="!canPublish || working"
            :variant="breaking ? 'destructive' : 'default'"
            @click="$emit('confirm')">
          <i v-if="working" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
          {{ actionLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Button } from '@components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@components/ui/dialog'

export default {
  name: 'PublishDialog',

  components: {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
  },

  props: {
    open: { type: Boolean, default: false },
    name: { type: String, required: true },
    version: { type: Number, default: 1 },
    /* Null when this publishes as something new, which covers a brand
     * new schema and every fork. */
    basedOn: { type: String, default: null },
    changes: { type: Array, default: () => [] },
    breaking: { type: Boolean, default: false },
    configured: { type: Array, default: () => [] },
    /* Null means the Directory could not be reached. Distinct from an
     * empty array, which means nothing is publishing. */
    publishing: { type: Array, default: null },
    referencedBy: { type: Array, default: () => [] },
    unresolved: { type: Array, default: () => [] },
    schemaNames: { type: Object, default: () => ({}) },
    working: { type: Boolean, default: false },
  },

  emits: ['update:open', 'confirm'],

  computed: {
    breakingChanges () {
      return this.changes.filter(c => c.breaking)
    },

    additiveChanges () {
      return this.changes.filter(c => !c.breaking)
    },

    /* A fork or a new schema publishes as itself. An edit to a
     * published local schema either updates in place or forks,
     * depending on what the classifier found. */
    publishesAsNew () {
      return !this.basedOn || this.breaking
    },

    actionLabel () {
      if (!this.basedOn) return 'Publish'
      return this.breaking ? `Publish as v${this.version + 1}` : 'Update'
    },

    outcomeLine () {
      if (this.unresolved.length)
        return 'Publishing is blocked until its components are published.'
      if (!this.basedOn)
        return `This publishes as v${this.version}.`
      if (this.breaking)
        return `Devices stay on v${this.version} until they are moved. `
          + `This publishes as v${this.version + 1}.`
      if (!this.changes.length)
        return 'Nothing to publish.'
      return `These changes are safe for devices already using v${this.version}.`
    },

    configuredLine () {
      const n = this.configured.length
      if (n === 0) return 'No devices are configured to use this schema.'
      if (n === 1) return '1 device is configured to use this schema.'
      return `${n} devices are configured to use this schema.`
    },

    publishingLine () {
      if (this.publishing === null)
        return 'Live device count unavailable: the Directory did not respond.'
      const n = this.publishing.length
      if (n === 0) return 'None are publishing it right now.'
      if (n === 1) return '1 is publishing it right now.'
      return `${n} are publishing it right now.`
    },

    referencedLine () {
      const n = this.referencedBy.length
      return n === 1
        ? '1 other schema uses this as a component.'
        : `${n} other schemas use this as a component.`
    },

    canPublish () {
      if (this.unresolved.length) return false
      /* Republishing an unchanged schema is a no-op worth preventing.
       * A new schema has no baseline and always has something to do. */
      if (this.basedOn && !this.changes.length) return false
      return true
    },
  },

  methods: {
    nameFor (uuid) {
      return this.schemaNames[uuid] ?? uuid
    },
  },
}
</script>
