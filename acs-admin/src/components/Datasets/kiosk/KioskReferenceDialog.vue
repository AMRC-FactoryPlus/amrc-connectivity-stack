<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Record a reference window: pick a type, then start now or add one
     that already happened. -->
<template>
  <Dialog :open="open" @update:open="v => !v && !busy && emit('close')">
    <DialogContent class="text-base sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle class="text-xl">Record a reference window</DialogTitle>
        <DialogDescription>A short recording of the equipment in a known state.</DialogDescription>
      </DialogHeader>
      <KioskChips v-model="type" :options="types" wide/>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <DialogFooter class="gap-2">
        <Button variant="outline" class="h-12 px-6 text-base" :disabled="busy" @click="emit('already', type)">It already happened</Button>
        <Button class="h-12 px-6 text-base" :disabled="busy || offline" @click="emit('start', type)">
          <i v-if="busy" class="fa-solid fa-circle-notch mr-2 animate-spin"></i>
          <i v-else class="fa-solid fa-circle mr-2 text-[10px] text-red-400"></i>Start now
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { REFERENCE_TYPES } from '@/lib/datasets/constants.js'
import KioskChips from './KioskChips.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  offline: { type: Boolean, default: false },
  error: { type: String, default: null },
})
const emit = defineEmits(['close', 'start', 'already'])

const HELP = {
  idle: 'Equipment on, not working.',
  'warm-up': 'Warming up before work.',
  calibration: 'A known reference cycle.',
  other: 'Any other known state.',
}
const types = REFERENCE_TYPES.map(t => ({ ...t, help: HELP[t.id] }))
const type = ref(REFERENCE_TYPES[0].id)
watch(() => props.open, v => { if (v) type.value = REFERENCE_TYPES[0].id })
</script>
