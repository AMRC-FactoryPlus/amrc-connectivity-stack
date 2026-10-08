<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Void a run. The dataset and its data stay; void marks it as not to
     be used. Call open(record) through a ref. -->
<template>
  <Dialog :open="!!target" @update:open="v => !v && close()">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Void this run</DialogTitle>
        <DialogDescription>
          The run and its data stay, marked as voided. You can restore it later.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-2">
        <Label>Reason</Label>
        <div class="flex flex-wrap gap-2">
          <button v-for="r in VOID_REASONS" :key="r" type="button"
                  :class="['rounded-full border px-3 py-1 text-sm transition-colors',
                           choice === r ? 'border-slate-900 bg-slate-900 text-slate-50' : 'border-slate-200 hover:bg-slate-100']"
                  :aria-pressed="choice === r" @click="choice = r">{{ r }}</button>
        </div>
        <input v-if="choice === 'Other'" v-model="other" placeholder="Say why"
               class="h-10 rounded-md border border-slate-200 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950"/>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close">Cancel</Button>
        <Button variant="destructive" :disabled="busy || !reasonText" @click="save">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>Void run
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
import { set_void } from '@/lib/datasets/api.js'
import { VOID_REASONS } from './page-logic.js'

const target = ref(null)
const choice = ref(null)
const other = ref('')
const busy = ref(false)
const error = ref(null)

const reasonText = computed(() => choice.value === 'Other' ? other.value.trim() : choice.value)

function open (record) {
  target.value = record
  choice.value = null
  other.value = ''
  error.value = null
}

function close () { target.value = null }

async function save () {
  busy.value = true
  error.value = null
  try {
    const sc = useServiceClientStore()
    await set_void(sc.client, target.value.uuid, { by: sc.username, reason: reasonText.value })
    toast.success('Run voided')
    close()
  }
  catch (err) {
    error.value = err?.status === 403 ? 'You do not have permission to void this run.' : (err?.message ?? 'The run was not voided.')
  }
  finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>
