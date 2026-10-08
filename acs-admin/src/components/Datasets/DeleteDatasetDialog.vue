<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Delete a dataset. The service refuses (HTTP 409) while other
     datasets include it; the dialog then lists them with links. Call
     open(record) through a ref. Emits `deleted` with the UUID. -->
<template>
  <Dialog :open="!!target" @update:open="v => !v && close()">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ referrers ? 'This dataset is in use' : 'Delete dataset' }}</DialogTitle>
        <DialogDescription v-if="!referrers">
          Delete "{{ name }}"? The data stays in the historian. Only this dataset's definition goes, and this cannot be undone.
        </DialogDescription>
        <DialogDescription v-else>
          The service refused to delete "{{ name }}" because {{ referrers.length }}
          other {{ referrers.length === 1 ? 'dataset includes' : 'datasets include' }} it.
          Delete or change {{ referrers.length === 1 ? 'that one' : 'those' }} first.
        </DialogDescription>
      </DialogHeader>

      <ul v-if="referrers" class="max-h-64 overflow-y-auto rounded-md border border-slate-200 divide-y">
        <li v-for="r in referrers" :key="r" class="px-3 py-2 text-sm">
          <RouterLink :to="`/datasets/${r}`" class="hover:underline" @click="close">
            {{ ds.byUuid[r] ? ds.name(r) : 'A dataset you cannot see' }}
          </RouterLink>
          <div class="text-xs text-slate-400 font-mono">{{ r }}</div>
        </li>
      </ul>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close">{{ referrers ? 'Close' : 'Cancel' }}</Button>
        <Button v-if="!referrers" variant="destructive" :disabled="busy" @click="confirm">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>
          Delete
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
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { delete_dataset } from '@/lib/datasets/api.js'
import { display_name } from '@/lib/datasets/model.js'

const emit = defineEmits(['deleted'])
const ds = useDatasetsStore()
const target = ref(null)
const referrers = ref(null)
const error = ref(null)
const busy = ref(false)
const name = computed(() => display_name(target.value))

function open (record) {
  target.value = record
  referrers.value = null
  error.value = null
}

function close () {
  target.value = null
}

async function confirm () {
  busy.value = true
  error.value = null
  try {
    const res = await delete_dataset(useServiceClientStore().client, target.value.uuid)
    if (res.ok) {
      toast.success('Dataset deleted')
      emit('deleted', target.value.uuid)
      close()
    }
    else if (res.referrers) referrers.value = res.referrers
    else error.value = res.reason
  }
  catch (err) {
    error.value = err.message ?? 'The delete failed.'
  }
  finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>
