<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Delete a dataset. The service refuses (HTTP 409) while other
     datasets include it; the dialog then lists them with links. A
     session over its own "<name> (devices)" union deletes that union
     too, session first. Opening the union itself offers to delete both,
     again session first. Call open(record) through a ref. Emits
     `deleted` with the UUID. -->
<template>
  <Dialog :open="!!target" @update:open="v => !v && close()">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ !owner && blocked ? 'This dataset is in use' : 'Delete dataset' }}</DialogTitle>
        <DialogDescription v-if="owner">
          "{{ name }}" is the device list of "{{ ownerName }}", and nothing else uses it.
          Delete "{{ ownerName }}" and this? The data stays in the historian, and this cannot be undone.
        </DialogDescription>
        <DialogDescription v-else-if="!blocked">
          Delete "{{ name }}"? The data stays in the historian. Only this dataset's definition goes, and this cannot be undone.
          <template v-if="plan.helper">This also deletes its device list, "{{ helperName }}", which nothing else uses.</template>
        </DialogDescription>
        <DialogDescription v-else>
          The service refused to delete "{{ name }}" because {{ remaining.length }}
          other {{ remaining.length === 1 ? 'dataset includes' : 'datasets include' }} it.
          Delete or change {{ remaining.length === 1 ? 'that one' : 'those' }} first.
        </DialogDescription>
      </DialogHeader>

      <ul v-if="blocked && !owner" class="max-h-64 overflow-y-auto rounded-md border border-slate-200 divide-y">
        <li v-for="r in remaining" :key="r" class="px-3 py-2 text-sm">
          <RouterLink :to="`/datasets/${r}`" class="hover:underline" @click="close">
            {{ ds.byUuid[r] ? ds.name(r) : 'A dataset you cannot see' }}
          </RouterLink>
          <div class="text-xs text-slate-400 font-mono">{{ r }}</div>
        </li>
      </ul>

      <p v-if="waiting" class="text-sm text-slate-500">
        <i class="fa-solid fa-circle-notch animate-spin mr-2"></i>{{ waitingText }}
      </p>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close">{{ blocked && !owner ? 'Close' : 'Cancel' }}</Button>
        <Button v-if="owner" variant="destructive" :disabled="busy" @click="deleteWithOwner">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>
          Delete "{{ ownerName }}" and this
        </Button>
        <Button v-else-if="!blocked" variant="destructive" :disabled="busy" @click="retry">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>
          {{ referrers ? 'Try again' : 'Delete' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { createDeleteFlow } from './delete-flow.js'

const emit = defineEmits(['deleted'])
const ds = useDatasetsStore()
const sc = useServiceClientStore()

// The logic lives in delete-flow.js, where it is tested.
const flow = createDeleteFlow({
  ds,
  client: () => sc.client,
  notify: {
    deleted: uuid => emit('deleted', uuid),
    success: text => toast.success(text),
    failure: (title, text) => toast.error(title, { description: text }),
  },
})
const {
  target, referrers, error, busy, waiting, waitingText, owner,
  name, ownerName, plan, helperName, remaining, blocked,
  close, retry, deleteWithOwner,
} = flow

defineExpose({ open: flow.open })
</script>
