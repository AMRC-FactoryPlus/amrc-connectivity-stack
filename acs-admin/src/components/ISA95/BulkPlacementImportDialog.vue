<!--
  - ACS Admin
  - Place many devices at once from a CSV.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <Dialog :open="isOpen" @update:open="handleOpen">
    <DialogContent class="sm:max-w-[760px] overflow-y-auto max-h-[85vh]">
      <DialogHeader>
        <DialogTitle>Import Placements</DialogTitle>
        <DialogDescription>
          Place devices from a CSV with the columns
          <code class="text-xs">{{ COLUMNS.join(', ') }}</code>.
          Each name must already be in the vocabulary. You can leave the
          lower levels empty.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <label for="placement-csv" class="text-sm font-medium">CSV</label>
            <Button variant="outline" size="sm" class="gap-2" :disabled="isSubmitting" @click="$refs.file.click()">
              <i class="fa-solid fa-upload"></i>
              <span>Upload a file</span>
            </Button>
            <input ref="file" type="file" accept=".csv,text/csv,text/plain" class="hidden" @change="onFile"/>
          </div>
          <textarea
              id="placement-csv"
              v-model="text"
              rows="8"
              spellcheck="false"
              :disabled="isSubmitting"
              :placeholder="PLACEHOLDER"
              class="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs
                     placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-slate-950 disabled:opacity-50"
          ></textarea>
        </div>

        <label class="flex items-center gap-2 text-sm">
          <Checkbox v-model="overwrite" :disabled="isSubmitting"/>
          <span>Overwrite existing placements</span>
        </label>

        <div v-if="!ready" class="flex items-center gap-2 text-sm text-gray-500">
          <i class="fa-solid fa-circle-notch animate-spin"></i>
          <span>Loading devices and the vocabulary...</span>
        </div>

        <template v-else-if="plan">
          <div class="text-sm text-gray-500">
            {{ plural(plan.changes.length, 'device') }} to place,
            {{ plan.unchanged }} unchanged,
            {{ plan.kept.length }} kept,
            {{ plural(errors.length, 'error') }}.
          </div>

          <div v-if="errors.length" class="flex flex-col gap-1">
            <div class="text-sm font-medium text-red-600">
              {{ plural(errors.length, 'line') }} cannot be imported
            </div>
            <div class="rounded-lg border border-red-200 divide-y divide-red-100 max-h-40 overflow-y-auto">
              <div v-for="(e, i) in errors" :key="i" class="flex gap-3 px-3 py-1.5 text-sm">
                <span class="text-gray-400 w-16 shrink-0">Line {{ e.line }}</span>
                <span>{{ e.message }}</span>
              </div>
            </div>
          </div>

          <div v-if="plan.changes.length" class="flex flex-col gap-1">
            <div class="text-sm font-medium">
              {{ plural(plan.changes.length, 'device') }} will change
            </div>
            <div class="rounded-lg border divide-y max-h-64 overflow-y-auto">
              <div v-for="c in plan.changes" :key="c.device" class="flex flex-col px-3 py-1.5 text-sm">
                <span class="font-medium">{{ c.name }}</span>
                <span class="text-gray-500">
                  {{ c.from ? c.from.join(' / ') : 'Not placed' }}
                  <i class="fa-solid fa-arrow-right text-xs mx-1"></i>
                  <span class="text-gray-900">{{ c.to.join(' / ') }}</span>
                </span>
              </div>
            </div>
          </div>

          <div v-if="plan.kept.length" class="text-sm text-gray-500">
            {{ plural(plan.kept.length, 'device') }} already
            {{ plan.kept.length === 1 ? 'has' : 'have' }} a placement and
            {{ plan.kept.length === 1 ? 'is' : 'are' }} kept. Select
            Overwrite existing placements to replace
            {{ plan.kept.length === 1 ? 'it' : 'them' }}.
          </div>
        </template>
      </div>

      <DialogFooter>
        <Button :disabled="!ready || !plan?.changes.length || isSubmitting" @click="apply">
          <div class="flex items-center justify-center gap-2">
            <i :class="isSubmitting ? 'fa-solid fa-circle-notch animate-spin' : 'fa-solid fa-file-import'"></i>
            <div>{{ applyLabel }}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useISA95Store } from '@store/useISA95Store.js'
import {
  PLACEMENT_CSV_COLUMNS, apply_placements, parse_placement_csv, plan_placements,
} from '@/lib/isa95-placement.js'
import { toast } from 'vue-sonner'

const PLACEHOLDER = [
  PLACEMENT_CSV_COLUMNS.join(','),
  '00000000-0000-4000-8000-000000000001,Acme,Site1,Area1,,',
  '00000000-0000-4000-8000-000000000002,Acme,Site1',
].join('\n')

export default {
  setup() {
    return {
      s: useServiceClientStore(),
      d: useDeviceStore(),
      isa95: useISA95Store(),
      COLUMNS: PLACEMENT_CSV_COLUMNS,
      PLACEHOLDER,
    }
  },

  components: {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  },

  mounted() {
    window.events.on('show-isa95-placement-import-dialog', () => {
      this.reset()
      this.isa95.start()
      if (!this.d.rxsub) this.d.start()
      this.isOpen = true
    })
  },

  data() {
    return {
      isOpen: false,
      isSubmitting: false,
      text: '',
      overwrite: false,
      done: 0,
      total: 0,
    }
  },

  computed: {
    ready() {
      return this.d.ready && this.isa95.ready
    },

    /* Device UUID -> { name, placement }, for plan_placements. */
    devices() {
      return new Map((this.d.data ?? []).map(d => [d.uuid, { name: d.name, placement: d.placement }]))
    },

    parsed() {
      return parse_placement_csv(this.text)
    },

    plan() {
      if (!this.ready || this.text.trim() === '') return null
      return plan_placements({
        rows:      this.parsed.rows,
        vocab:     this.isa95.vocabulary,
        devices:   this.devices,
        overwrite: this.overwrite,
      })
    },

    /* Errors from reading the CSV and from planning, in line order. */
    errors() {
      if (!this.plan) return []
      return [...this.parsed.errors, ...this.plan.errors].sort((a, b) => a.line - b.line)
    },

    applyLabel() {
      if (this.isSubmitting) return `Placing ${this.done} of ${this.total}...`
      const n = this.plan?.changes.length ?? 0
      return n ? `Place ${this.plural(n, 'device')}` : 'Place devices'
    },
  },

  methods: {
    plural(n, noun) {
      return `${n} ${noun}${n === 1 ? '' : 's'}`
    },

    handleOpen(open) {
      if (this.isSubmitting) return
      this.isOpen = open
      if (!open) this.reset()
    },

    reset() {
      this.text = ''
      this.overwrite = false
      this.done = 0
      this.total = 0
    },

    async onFile(event) {
      const file = event.target.files?.[0]
      /* Let the same file be chosen again after an edit. */
      event.target.value = ''
      if (!file) return
      try {
        this.text = await file.text()
      } catch (err) {
        console.error('Failed to read placement CSV:', err)
        toast.error('Unable to read the file', {
          description: err.message || 'An unexpected error occurred',
        })
      }
    },

    /* Write each placement in turn. Nothing else is written: the
     * placement watcher updates the Edge Agent configs. The plan is
     * copied first, because it shrinks as the store sees each write. */
    async apply() {
      const changes = [...this.plan.changes]

      this.isSubmitting = true
      this.done = 0
      this.total = changes.length
      const failed = await apply_placements(this.s.client.ConfigDB, changes,
        done => { this.done = done })
      this.isSubmitting = false
      for (const f of failed)
        console.error('Failed to place device %s: %s', f.device, f.message)

      const placed = changes.length - failed.length
      if (failed.length === 0) {
        toast.success(`Placed ${this.plural(placed, 'device')}`)
        this.isOpen = false
        this.reset()
        return
      }
      toast.error(`Placed ${this.plural(placed, 'device')}, ${failed.length} failed`, {
        description: `${failed[0].name}: ${failed[0].message || 'an unexpected error occurred'}. `
          + 'Apply the import again to retry the devices that failed.',
      })
    },
  },
}
</script>
