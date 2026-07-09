<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="isOpen" @update:open="handleOpen">
    <DialogContent class="sm:max-w-[700px] overflow-y-auto max-h-[80vh]">
      <DialogHeader>
        <DialogTitle>Import ISA-95 Hierarchy from Devices</DialogTitle>
        <DialogDescription>
          Build the vocabulary from the hierarchy values already saved on your
          devices. Matching values are linked to existing nodes; new values
          become new nodes, which you can rename or prune afterwards.
        </DialogDescription>
      </DialogHeader>

      <!-- Scanning -->
      <div v-if="scanning" class="flex items-center justify-center gap-3 py-10 text-gray-500">
        <i class="fa-solid fa-circle-notch animate-spin"></i>
        <span>Scanning devices...</span>
      </div>

      <!-- Preview -->
      <div v-else-if="plan" class="flex flex-col gap-4">
        <div class="text-sm text-gray-500">
          Scanned {{ deviceCount }} device{{ deviceCount === 1 ? '' : 's' }}:
          {{ plan.stats.imported }} with a hierarchy,
          {{ plan.stats.no_hierarchy }} without.
        </div>

        <Alert v-if="plan.stats.ignored_tails > 0">
          <AlertTitle>Some values cannot be placed</AlertTitle>
          <AlertDescription>
            {{ plan.stats.ignored_tails }} device{{ plan.stats.ignored_tails === 1 ? ' has' : 's have' }}
            hierarchy values below a missing level (for example an Area with no
            Site). Those values are left on the device but not imported.
          </AlertDescription>
        </Alert>

        <div v-if="plan.creates.length === 0 && plan.aliases.length === 0"
            class="text-center py-6 text-gray-500">
          <i class="fa-solid fa-check text-green-500 mr-2"></i>
          Every device hierarchy already matches the vocabulary. Nothing to import.
        </div>

        <template v-else>
          <div v-if="plan.creates.length > 0" class="flex flex-col gap-1">
            <div class="text-sm font-medium">
              {{ plan.creates.length }} new node{{ plan.creates.length === 1 ? '' : 's' }}
            </div>
            <div class="rounded-lg border divide-y max-h-64 overflow-y-auto">
              <div v-for="c in previewRows" :key="c.key" class="flex items-center gap-2 px-3 py-2 text-sm">
                <span class="text-gray-400 text-xs uppercase tracking-wide w-24 shrink-0">{{ c.level }}</span>
                <span class="font-medium">{{ c.name }}</span>
                <span v-if="c.parent" class="text-gray-400 truncate">under {{ c.parent }}</span>
              </div>
            </div>
          </div>

          <div v-if="plan.aliases.length > 0" class="flex flex-col gap-1">
            <div class="text-sm font-medium">
              {{ plan.aliases.length }} alias{{ plan.aliases.length === 1 ? '' : 'es' }} for existing nodes
            </div>
            <div class="rounded-lg border divide-y max-h-40 overflow-y-auto">
              <div v-for="(a, i) in plan.aliases" :key="i" class="flex items-center gap-2 px-3 py-2 text-sm">
                <span class="font-medium">{{ isa95.by_uuid(a.uuid)?.name ?? a.uuid }}</span>
                <span class="text-gray-400">also known as</span>
                <span>{{ a.alias }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>

      <DialogFooter>
        <Button v-if="hasWork" :disabled="scanning || isSubmitting" @click="apply">
          <div class="flex items-center justify-center gap-2">
            <i :class="{'fa-solid': true, 'fa-file-import': !isSubmitting, 'fa-circle-notch animate-spin': isSubmitting}"></i>
            <div>{{ isSubmitting ? 'Importing...' : 'Import' }}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@components/ui/alert'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { ISA95_LEVELS, useISA95Store } from '@store/useISA95Store.js'
import { plan_import, apply_plan } from '@/composables/useISA95Migration.js'
import { toast } from 'vue-sonner'

export default {
  setup() {
    return {
      s: useServiceClientStore(),
      device: useDeviceStore(),
      isa95: useISA95Store(),
    }
  },

  components: {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Alert,
    AlertDescription,
    AlertTitle,
  },

  async mounted() {
    window.events.on('show-isa95-import-dialog', () => {
      this.isOpen = true
      this.scan()
    })
  },

  data() {
    return {
      isOpen: false,
      scanning: false,
      isSubmitting: false,
      plan: null,
      deviceCount: 0,
    }
  },

  computed: {
    hasWork() {
      return this.plan &&
        (this.plan.creates.length > 0 || this.plan.aliases.length > 0)
    },
    /* Creates in level order, with the parent name resolved for display. */
    previewRows() {
      const by_key = new Map(this.plan.creates.map(c => [c.key, c]))
      const parent_of = new Map()
      for (const c of this.plan.creates)
        for (const k of c.children) parent_of.set(k, c.name)
      for (const l of this.plan.links)
        parent_of.set(l.child_key, this.isa95.by_uuid(l.parent_uuid)?.name)

      return [...this.plan.creates]
        .sort((a, b) => ISA95_LEVELS.indexOf(a.level) - ISA95_LEVELS.indexOf(b.level))
        .map(c => ({ ...c, parent: parent_of.get(c.key) ?? null }))
    },
  },

  methods: {
    handleOpen(open) {
      this.isOpen = open
      if (!open) {
        this.plan = null
      }
    },

    async scan() {
      this.scanning = true
      this.plan = null
      try {
        await this.isa95.start()
        await this.device.start()
        await this.device.storeReady()
        this.deviceCount = this.device.data.length
        this.plan = plan_import(this.device.data, this.isa95.data)
      } catch (err) {
        console.error('Failed to scan devices:', err)
        toast.error('Failed to scan devices', {
          description: err.message || 'An unexpected error occurred'
        })
        this.isOpen = false
      } finally {
        this.scanning = false
      }
    },

    async apply() {
      this.isSubmitting = true
      try {
        const result = await apply_plan(this.s.client.ConfigDB, this.plan, this.isa95.data)
        toast.success('Hierarchy imported', {
          description: `${result.created} node${result.created === 1 ? '' : 's'} created, ${result.updated} existing node${result.updated === 1 ? '' : 's'} updated.`,
        })
        this.isOpen = false
        this.plan = null
      } catch (err) {
        console.error('Failed to import hierarchy:', err)
        toast.error('Failed to import hierarchy', {
          description: err.message || 'An unexpected error occurred'
        })
      } finally {
        this.isSubmitting = false
      }
    },
  },
}
</script>
