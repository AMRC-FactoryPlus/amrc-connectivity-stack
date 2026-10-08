<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Correct the start time of the recording in progress. It changes the
     record on the server only; nothing is saved as a dataset yet. -->
<template>
  <Dialog :open="open" @update:open="v => !v && !busy && emit('close')">
    <DialogContent class="text-base sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle class="text-xl">Correct start time</DialogTitle>
        <DialogDescription>Move the start to when the work began. It cannot be in the future.</DialogDescription>
      </DialogHeader>
      <KioskTimeStepper v-model="from" label="Start" :now="now" show-day/>
      <p v-if="from !== startedAt" class="text-sm text-gray-700">
        Was {{ fmt_clock(startedAt, true) }}. The timer counts from {{ fmt_clock(from, true) }}.
      </p>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <DialogFooter class="gap-2">
        <Button variant="outline" class="h-12 px-6 text-base" :disabled="busy" @click="emit('close')">Cancel</Button>
        <Button class="h-12 px-6 text-base" :disabled="busy || from === startedAt || from > now" @click="emit('save', from)">
          <i v-if="busy" class="fa-solid fa-circle-notch mr-2 animate-spin"></i>Save start time
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { fmt_clock } from '@/lib/datasets/model.js'
import KioskTimeStepper from './KioskTimeStepper.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  startedAt: { type: Number, default: 0 },
  now: { type: Number, required: true },
  busy: { type: Boolean, default: false },
  error: { type: String, default: null },
})
const emit = defineEmits(['close', 'save'])

const from = ref(0)
watch(() => props.open, v => { if (v) from.value = props.startedAt }, { immediate: true })
</script>
