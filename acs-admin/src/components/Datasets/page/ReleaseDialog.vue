<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Release a dataset: add it to Published, so the briefcase exporter
     builds a briefcase of it. Call open(record) through a ref. -->
<template>
  <Dialog :open="!!target" @update:open="v => !v && close()">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Release this dataset</DialogTitle>
        <DialogDescription>
          The briefcase exporter will build a briefcase of this dataset under its release policy,
          and store it in Files for you to download and pass on.
        </DialogDescription>
      </DialogHeader>

      <dl v-if="policy" class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt class="text-slate-500">Who may have it</dt>
        <dd>{{ TIERS[policy.tier] ?? policy.tier }}</dd>
        <dt class="text-slate-500">Terms</dt>
        <dd>{{ policy.terms?.licence ? `Licence ${policy.terms.licence}` : `Data sharing agreement ${policy.terms?.agreement}` }}</dd>
        <dt class="text-slate-500">Data owner</dt>
        <dd>{{ policy.data_owner?.organisation }}</dd>
      </dl>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close">Cancel</Button>
        <Button :disabled="busy" @click="save">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>Release
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { TIERS, release_policy, release_dataset } from '@/lib/datasets/release.js'

const target = ref(null)
const busy = ref(false)
const error = ref(null)

const policy = computed(() => release_policy(target.value))

function open (record) {
  target.value = record
  error.value = null
}

function close () { target.value = null }

async function save () {
  busy.value = true
  error.value = null
  try {
    await release_dataset(useServiceClientStore().client, target.value.uuid)
    toast.success('Dataset released', { description: 'The exporter is building its briefcase.' })
    close()
  }
  catch (err) {
    error.value = err?.status === 403 ? 'You do not have permission to release datasets.' : (err?.message ?? 'The dataset was not released.')
  }
  finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>
