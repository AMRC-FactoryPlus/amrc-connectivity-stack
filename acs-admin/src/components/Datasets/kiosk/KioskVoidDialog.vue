<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Void the recording in progress: it stops, is saved as a run and
     marked void with the reason, so it stays on the lane as voided. -->
<template>
  <Dialog :open="open" @update:open="v => !v && !busy && emit('close')">
    <DialogContent class="text-base sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="text-xl">Void this recording?</DialogTitle>
        <DialogDescription>The recording stops and is kept as a voided run, with the reason you choose.</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium text-slate-700">Reason</span>
        <KioskChips v-model="reason" :options="REASONS"/>
      </div>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <DialogFooter class="gap-2">
        <Button variant="outline" class="h-12 px-6 text-base" :disabled="busy" @click="emit('close')">Keep recording</Button>
        <Button variant="destructive" class="h-12 px-6 text-base" :disabled="!reason || busy" @click="emit('confirm', reason)">
          <i v-if="busy" class="fa-solid fa-circle-notch mr-2 animate-spin"></i>Void recording
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import KioskChips from './KioskChips.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: null },
})
const emit = defineEmits(['close', 'confirm'])

const REASONS = ['Started on the wrong equipment', 'Test, not a real job', 'Job was abandoned', 'Other']
const reason = ref(null)
watch(() => props.open, v => { if (v) reason.value = null })
</script>
