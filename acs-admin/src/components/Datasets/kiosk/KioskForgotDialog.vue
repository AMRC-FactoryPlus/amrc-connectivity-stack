<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Add a recording someone forgot to start (or a reference window that
     already happened). Start and end use steppers; neither can be in
     the future. Warns about overlaps but still allows the save. -->
<template>
  <Dialog :open="open" @update:open="v => !v && !busy && emit('close')">
    <DialogContent class="text-base sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle class="text-xl">{{ title }}</DialogTitle>
        <DialogDescription>
          {{ equipmentName }} · {{ fmt_day(from) }}. It is saved like any other recording and marked as added afterwards.
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 sm:grid-cols-2">
        <KioskTimeStepper v-model="from" label="Started" :now="now" compact/>
        <KioskTimeStepper v-model="to" label="Ended" :now="now" compact/>
      </div>
      <div class="text-sm text-gray-700">
        Duration: <span :class="bad ? 'text-red-600' : ''">{{ bad ? 'The end must be after the start.' : fmt_duration(to - from) }}</span>
      </div>
      <div v-if="overlaps.length" class="text-sm text-amber-700">
        <i class="fa-solid fa-circle-exclamation mr-1"></i>
        Overlaps {{ overlaps.map(r => `${fmt_clock(Date.parse(r.from))} to ${fmt_clock(Date.parse(r.to))}`).join(', ') }}. You can still save it.
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium text-slate-700">Reason</span>
        <KioskChips v-model="reason" :options="reasons"/>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <DialogFooter class="gap-2">
        <Button variant="outline" class="h-12 px-6 text-base" :disabled="busy" @click="emit('close')">Cancel</Button>
        <Button class="h-12 px-6 text-base" :disabled="bad || !reason || busy" @click="emit('save', { from, to, reason })">
          <i v-if="busy" class="fa-solid fa-circle-notch mr-2 animate-spin"></i>Save recording
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { REFERENCE_TYPES } from '@/lib/datasets/constants.js'
import { fmt_clock, fmt_day, fmt_duration } from '@/lib/datasets/model.js'
import { forgot_default, overlapping_runs, MINUTE } from '@/lib/datasets/kiosk.js'
import KioskTimeStepper from './KioskTimeStepper.vue'
import KioskChips from './KioskChips.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  equipmentName: { type: String, default: '' },
  runs: { type: Array, default: () => [] },
  reference: { type: String, default: null },
  now: { type: Number, required: true },
  busy: { type: Boolean, default: false },
  error: { type: String, default: null },
})
const emit = defineEmits(['close', 'save'])

const from = ref(0)
const to = ref(0)
const reason = ref(null)

watch(() => props.open, v => {
  if (!v) return
  const w = props.reference
    // A reference window is short: guess the quarter hour before now.
    ? { from: Math.floor((props.now - 20 * MINUTE) / MINUTE) * MINUTE, to: Math.floor((props.now - 5 * MINUTE) / MINUTE) * MINUTE }
    : forgot_default(props.runs, props.now)
  from.value = w.from
  to.value = w.to
  reason.value = props.reference ? 'Recorded afterwards' : 'Forgot to press Start'
}, { immediate: true })

const refLabel = computed(() => REFERENCE_TYPES.find(t => t.id === props.reference)?.label)
const title = computed(() => props.reference
  ? `Add a ${refLabel.value?.toLowerCase() ?? ''} reference window that already happened`
  : 'Add a recording you forgot to start')
const reasons = computed(() => props.reference
  ? ['Recorded afterwards', 'Tablet was off', 'No connection at the time', 'Other']
  : ['Forgot to press Start', 'Tablet was off', 'No connection at the time', 'Other'])
const bad = computed(() => !(to.value > from.value))
const overlaps = computed(() => overlapping_runs(props.runs, from.value, to.value))
</script>
