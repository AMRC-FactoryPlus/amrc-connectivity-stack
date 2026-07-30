<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="isOpen" @update:open="handleOpen">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>Make a local copy</DialogTitle>
        <DialogDescription v-if="source?.origin === 'AMRC library'">
          This schema comes from the AMRC library. Editing creates a local copy.
        </DialogDescription>
        <DialogDescription v-else>
          The copy is a separate schema. Devices stay on the original until you move them.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">
            Name <span class="text-red-500">*</span>
          </label>
          <Input v-model="name" placeholder="e.g. CNC Sheffield"/>
          <p class="text-xs text-gray-500">
            Give the copy its own name. It starts at v1 with its own version
            history, so a later AMRC release cannot collide with it.
          </p>
          <p v-if="nameTaken" class="text-xs text-red-500">
            A schema with this name already exists.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleOpen(false)">Cancel</Button>
        <Button :disabled="!canCreate || working" @click="create">
          <i v-if="working" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
          Make a local copy
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { toast } from 'vue-sonner'
import { v4 as uuidv4 } from 'uuid'

import { Button } from '@components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@components/ui/dialog'
import { Input } from '@components/ui/input'

import { useSchemaStore } from '@store/useSchemaStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { forkDocument, parse, serialise } from '@/lib/schema/document.js'
import { createDraft, versionOf } from '@/lib/schema/registry.js'

export default {
  name: 'ForkDialog',

  components: {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle, Input,
  },

  setup () {
    return {
      sch: useSchemaStore(),
      s: useServiceClientStore(),
    }
  },

  data () {
    return {
      isOpen: false,
      source: null,
      name: '',
      working: false,
    }
  },

  computed: {
    /* Names are compared across published schemas only. Two drafts with
     * the same name are the author's business; two published schemas
     * with the same name are the collision the rule exists to stop. */
    existingNames () {
      return new Set((this.sch.data ?? [])
        .map(e => (e.schemaInformation?.name ?? e.name ?? '').toLowerCase()))
    },

    nameTaken () {
      return !!this.name && this.existingNames.has(this.name.trim().toLowerCase())
    },

    canCreate () {
      return !!this.name.trim() && !this.nameTaken
    },
  },

  async mounted () {
    await this.sch.start()
    window.events.on('show-fork-schema-dialog', (source) => {
      this.source = source
      /* Defaulted, not imposed. The author still has to look at it. */
      this.name = `${source.name} (local)`
      this.isOpen = true
    })
  },

  methods: {
    handleOpen (open) {
      this.isOpen = open
      if (!open) {
        this.source = null
        this.name = ''
      }
    },

    async create () {
      this.working = true
      try {
        const entry = this.sch.data.find(e => e.uuid === this.source.uuid)
        if (!entry?.schema) throw new Error('Schema body not available')

        /* A fork always mints a new UUID. That is what puts it beyond
         * the reach of both schema loaders, neither of which knows
         * locally authored schemas exist. */
        const schemaUuid = uuidv4()
        const name = this.name.trim()
        const doc = forkDocument(parse(entry.schema), schemaUuid, name)

        const draftUuid = await createDraft(this.s.client, {
          name,
          schemaUuid,
          body: serialise(doc),
          /* A fork publishes as something new, so it edits nothing. */
          basedOn: null,
          derivedFrom: this.source.uuid,
          /* Local version history restarts, so the AMRC library shipping
           * its own v2 later cannot collide. */
          version: 1,
        })

        toast.success(`${name} created as a draft`)
        this.handleOpen(false)
        this.$router.push(`/schemas/draft/${draftUuid}`)
      } catch (err) {
        console.error('Failed to fork schema', err)
        toast.error('Could not create the copy', { description: err.message })
      } finally {
        this.working = false
      }
    },
  },
}
</script>
