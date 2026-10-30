<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Withdraw a dataset: take it out of Published, so the exporter marks
     its briefcase withdrawn. The reason is kept with the briefcase.
     Call open(record, briefcase) through a ref, where briefcase is the
     live one's UUID, or null if the exporter has not built it yet. -->
<template>
  <Dialog :open="!!target" @update:open="v => !v && close()">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Withdraw this dataset</DialogTitle>
        <DialogDescription>
          Its briefcase is marked withdrawn and kept in Files as a record of what left.
          Copies already passed on outside Factory+ are not recalled: remove them from Windchill by hand.
        </DialogDescription>
      </DialogHeader>

      <div v-if="briefcase" class="flex flex-col gap-1">
        <Label for="wd-reason">Reason</Label>
        <textarea id="wd-reason" v-model="reason" rows="3" placeholder="Why is this briefcase being withdrawn?"
                  class="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"></textarea>
        <p class="text-xs text-slate-500">Kept with briefcase {{ briefcase.slice(0, 8) }} inside Factory+. It is not sent anywhere.</p>
      </div>
      <p v-else class="text-sm text-slate-600">
        The exporter has not built a briefcase of this dataset yet, so there is nothing to give a reason for.
      </p>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close">Cancel</Button>
        <Button variant="destructive" :disabled="busy || (briefcase && !reason.trim())" @click="save">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>Withdraw
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { withdraw_dataset } from '@/lib/datasets/release.js'

const target = ref(null)
const briefcase = ref(null)
const reason = ref('')
const busy = ref(false)
const error = ref(null)

function open (record, live) {
  target.value = record
  briefcase.value = live ?? null
  reason.value = ''
  error.value = null
}

function close () { target.value = null }

async function save () {
  busy.value = true
  error.value = null
  try {
    const sc = useServiceClientStore()
    await withdraw_dataset(sc.client, target.value.uuid, {
      briefcase: briefcase.value,
      reason: reason.value.trim(),
      by: sc.username,
    })
    toast.success('Dataset withdrawn')
    close()
  }
  catch (err) {
    error.value = err?.status === 403 ? 'You do not have permission to withdraw datasets.' : (err?.message ?? 'The dataset was not withdrawn.')
  }
  finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>
