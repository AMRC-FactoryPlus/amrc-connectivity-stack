<!--
  - ACS Admin
  - Merge a duplicate engineering unit into another unit.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <Dialog :open="isOpen && !!unit" @update:open="handleOpen">
    <DialogContent v-if="unit" class="sm:max-w-[560px] overflow-y-auto max-h-[85vh]">
      <DialogHeader>
        <DialogTitle>Merge {{ unit.symbol }}</DialogTitle>
        <DialogDescription>
          Merge {{ unit.name }} ({{ unit.code }}) into another unit. Its
          symbol and aliases become aliases of the unit you choose, so
          metrics written either way mean that unit. Then
          {{ unit.symbol }} is deleted. No metric is changed.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Merge into <span class="text-red-500">*</span></label>
          <Select v-model="target" :disabled="isSubmitting || targets.length === 0">
            <SelectTrigger>
              <SelectValue>
                {{ targetUnit ? label(targetUnit) : 'Choose a unit...' }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="t in targets" :value="t.uuid" :key="t.uuid">
                  {{ label(t) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div v-if="targetUnit" class="text-sm text-gray-500">
          {{ targetUnit.symbol }} will also be written
          <span class="font-mono">{{ merged.aliases.join(', ') }}</span>.
          i3X will report metrics written {{ unit.symbol }} as {{ targetUnit.code }},
          not {{ unit.code }}.
        </div>
      </div>

      <DialogFooter>
        <Button :disabled="!targetUnit || isSubmitting" @click="apply">
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
import { toast } from 'vue-sonner'

import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useEngUnitStore } from '@store/useEngUnitStore.js'
import { merge_units, merged_unit } from '@/lib/eng-units.js'

export default {
  name: 'MergeUnitDialog',

  setup () {
    return {
      s: useServiceClientStore(),
      units: useEngUnitStore(),
    }
  },

  components: {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
    Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
  },

  mounted () {
    window.events.on('show-unit-merge-dialog', this.open)
  },

  unmounted () {
    window.events.off('show-unit-merge-dialog', this.open)
  },

  data () {
    return {
      isOpen: false,
      isSubmitting: false,
      unit: null,
      target: null,
    }
  },

  computed: {
    targets () {
      return this.units.data
        .filter(u => u.uuid !== this.unit?.uuid)
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
    },
    targetUnit () {
      return this.units.by_uuid(this.target) ?? null
    },
    merged () {
      return merged_unit(this.unit, this.targetUnit)
    },
  },

  methods: {
    open (unit) {
      this.unit = unit
      this.target = null
      this.isOpen = true
    },

    handleOpen (open) {
      this.isOpen = open
      if (!open) this.unit = null
    },

    label (u) {
      return `${u.symbol}, ${u.name} (${u.code})`
    },

    async apply () {
      this.isSubmitting = true
      try {
        const into = this.targetUnit
        await merge_units(this.s.client.ConfigDB, this.unit, into)
        toast.success(`Merged ${this.unit.symbol} into ${into.symbol}`)
        window.events.emit('unit-merged', into.uuid)
        this.isOpen = false
        this.unit = null
      }
      catch (err) {
        console.error('Failed to merge unit:', err)
        toast.error('Failed to merge unit', {
          description: err.message || 'An unexpected error occurred',
        })
      }
      finally {
        this.isSubmitting = false
      }
    },
  },
}
</script>
