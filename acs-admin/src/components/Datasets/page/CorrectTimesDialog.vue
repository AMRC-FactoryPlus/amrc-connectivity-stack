<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Correct a run's start or end time, in London time. This edits the
     dataset definition, and the change is logged on the run. Call
     open(record) through a ref. -->
<template>
  <Dialog :open="!!target" @update:open="v => !v && close()">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Correct start or end time</DialogTitle>
        <DialogDescription>Times are in UK time. Seconds are kept from the current times unless you change the minute.</DialogDescription>
      </DialogHeader>

      <div class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
        <span>This edits the dataset definition. Anyone using this dataset gets the new window, and the change is logged on the run.</span>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <Label for="ct-from">Start</Label>
          <input id="ct-from" v-model="from" type="datetime-local" :class="field"/>
        </div>
        <div class="flex flex-col gap-1">
          <Label for="ct-to">End</Label>
          <input id="ct-to" v-model="to" type="datetime-local" :class="field"/>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <Label for="ct-reason">Reason</Label>
        <input id="ct-reason" v-model="reason" placeholder="For example, the recording started late" :class="field"/>
      </div>

      <p v-if="problem" class="text-sm text-red-600">{{ problem }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close">Cancel</Button>
        <Button :disabled="busy || !!invalid" @click="save">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>Save times
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { correct_times } from '@/lib/datasets/api.js'
import { ms_to_london_local, london_local_to_ms, validate_window } from '@/lib/datasets/model.js'

const field = 'h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2'

const target = ref(null)
const from = ref('')
const to = ref('')
const reason = ref('')
const busy = ref(false)
const error = ref(null)
let original = { from: '', to: '' }

// Keep the stored instant when the minute shown has not changed, so
// opening and saving does not drop seconds.
function instant (local, which) {
  if (local === original[which] && target.value?.[which]) return Date.parse(target.value[which])
  return london_local_to_ms(local)
}

const invalid = computed(() => {
  if (!target.value) return null
  const f = instant(from.value, 'from'), t = instant(to.value, 'to')
  if (Number.isNaN(f) || Number.isNaN(t)) return 'Enter a start and an end.'
  return validate_window(new Date(f).toISOString(), new Date(t).toISOString())
})
const problem = computed(() => error.value ?? (from.value && to.value ? invalid.value : null))

function open (record) {
  target.value = record
  original = {
    from: record.from ? ms_to_london_local(Date.parse(record.from)) : '',
    to: record.to ? ms_to_london_local(Date.parse(record.to)) : '',
  }
  from.value = original.from
  to.value = original.to
  reason.value = ''
  error.value = null
}

function close () { target.value = null }

async function save () {
  busy.value = true
  error.value = null
  try {
    const sc = useServiceClientStore()
    await correct_times(sc.client, target.value, {
      from: new Date(instant(from.value, 'from')).toISOString(),
      to: new Date(instant(to.value, 'to')).toISOString(),
      by: sc.username,
      reason: reason.value.trim() || null,
    })
    toast.success('Times corrected')
    close()
  }
  catch (err) {
    error.value = [err?.message, err?.detail].filter(Boolean).join(' ') || 'The times were not changed.'
  }
  finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>
