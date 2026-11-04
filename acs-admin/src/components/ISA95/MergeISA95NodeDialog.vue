<!--
  - ACS Admin
  - Merge a duplicate ISA-95 node into another node of the same level.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <Dialog :open="isOpen && !!node" @update:open="handleOpen">
    <DialogContent v-if="node" class="sm:max-w-[560px] overflow-y-auto max-h-[85vh]">
      <DialogHeader>
        <DialogTitle>Merge {{ node.name }}</DialogTitle>
        <DialogDescription>
          Merge this {{ node.level }} into another {{ node.level }}. Its
          children and the devices placed on it move to the node you choose.
          Its name and aliases become aliases of that node. Then
          {{ node.name }} is deleted.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Merge into <span class="text-red-500">*</span></label>
          <Select v-model="target" :disabled="isSubmitting || targets.length === 0">
            <SelectTrigger>
              <SelectValue>
                {{ targetLabel ?? `Choose ${article} ${node.level}...` }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="t in targets" :value="t.uuid" :key="t.uuid">
                  {{ t.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p v-if="targets.length === 0" class="text-xs text-gray-500">
            There is no other {{ node.level }} to merge into.
          </p>
        </div>

        <div class="text-sm text-gray-500">
          <template v-if="!d.ready">Loading devices...</template>
          <template v-else>
            {{ placedHere }} device{{ placedHere === 1 ? ' is' : 's are' }}
            placed directly on {{ node.name }} and will move. Devices placed
            below it keep their nodes, which move with the children.
          </template>
        </div>

        <div v-if="plan?.error" class="text-sm text-red-600">{{ plan.error }}</div>
      </div>

      <DialogFooter>
        <Button :disabled="!canApply || isSubmitting" @click="apply">
          <div class="flex items-center justify-center gap-2">
            <i :class="isSubmitting ? 'fa-solid fa-circle-notch animate-spin' : 'fa-solid fa-code-merge'"></i>
            <div>{{ isSubmitting ? 'Merging...' : 'Merge' }}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useISA95Store } from '@store/useISA95Store.js'
import { apply_merge, merge_targets, placement_path, plan_merge } from '@/lib/isa95-placement.js'
import { toast } from 'vue-sonner'

export default {
  setup() {
    return {
      s: useServiceClientStore(),
      d: useDeviceStore(),
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
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
  },

  mounted() {
    window.events.on('show-isa95-merge-dialog', (node) => {
      this.uuid = node?.uuid ?? null
      this.target = null
      this.isa95.start()
      if (!this.d.rxsub) this.d.start()
      this.isOpen = true
    })
  },

  data() {
    return {
      isOpen: false,
      isSubmitting: false,
      uuid: null,
      target: null,
    }
  },

  computed: {
    /* Read from the store so the dialog sees edits made meanwhile. */
    node() {
      return this.uuid ? this.isa95.by_uuid(this.uuid) ?? null : null
    },

    article() {
      return /^[AEIOU]/.test(this.node?.level ?? '') ? 'an' : 'a'
    },

    /* Same-level nodes, labelled with their path so two nodes with the
     * same name under different parents can be told apart. */
    targets() {
      if (!this.node) return []
      const vocab = this.isa95.vocabulary
      return merge_targets(vocab, this.node.uuid).map(n => {
        const path = placement_path(vocab, { node: n.uuid })
        return { uuid: n.uuid, label: path.length ? path.join(' / ') : n.name }
      })
    },

    targetLabel() {
      return this.targets.find(t => t.uuid === this.target)?.label ?? null
    },

    /* Device UUID -> placement, from the device store. */
    placements() {
      return new Map((this.d.data ?? []).map(d => [d.uuid, d.placement]))
    },

    placedHere() {
      let n = 0
      for (const p of this.placements.values()) if (p?.node === this.uuid) n++
      return n
    },

    plan() {
      if (!this.node || !this.target) return null
      return plan_merge(this.isa95.vocabulary, this.node.uuid, this.target, this.placements)
    },

    canApply() {
      return this.d.ready && this.isa95.ready && !!this.plan?.steps
    },
  },

  methods: {
    handleOpen(open) {
      if (this.isSubmitting) return
      this.isOpen = open
      if (!open) {
        this.uuid = null
        this.target = null
      }
    },

    /* Apply the steps in order. A merge that stops part way can be run
     * again: the plan is worked out afresh from what is now stored. */
    async apply() {
      const from = this.node
      const into = this.isa95.by_uuid(this.target)
      const { steps } = this.plan
      const moved = steps.filter(s => s.placement).length

      this.isSubmitting = true
      try {
        await apply_merge(this.s.client.ConfigDB, steps)
        toast.success(`Merged ${from.name} into ${into.name}`, {
          description: `${moved} device${moved === 1 ? '' : 's'} moved.`,
        })
        window.events.emit('isa95-node-merged', into.uuid)
        this.isOpen = false
        this.uuid = null
        this.target = null
      } catch (err) {
        console.error('Failed to merge node:', err)
        toast.error('The merge stopped part way', {
          description: `${err.message || 'An unexpected error occurred'}. Run the merge again to finish it.`,
        })
      } finally {
        this.isSubmitting = false
      }
    },
  },
}
</script>
