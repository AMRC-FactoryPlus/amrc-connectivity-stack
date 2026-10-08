<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Save ticked runs as a process or a part. Call open(kind, items)
     through a ref. On success it shows a toast and opens the new
     dataset. Used by the list and the Compare page. -->
<template>
  <Dialog :open="open_" @update:open="v => !v && close()">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Save as {{ kind }}</DialogTitle>
        <DialogDescription>
          {{ kind === 'part' ? 'A part' : 'A process' }} groups
          {{ items.length }} {{ items.length === 1 ? 'run' : 'runs' }}.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="save">
        <div class="flex flex-col gap-1.5">
          <Label for="group-name">Name</Label>
          <Input id="group-name" v-model="name" :placeholder="kind === 'part' ? 'Bracket, serial 0042' : 'Bracket trial, batch 3'"/>
        </div>

        <div v-if="repeats" class="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <i class="fa-solid fa-triangle-exclamation mt-0.5"></i>
          <span>Some runs share devices and overlap in time, so the download repeats those rows.</span>
        </div>

        <div v-if="error" class="text-sm text-red-600">
          <div>{{ error.message }}</div>
          <div v-if="error.detail" class="text-xs">{{ error.detail }}</div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="close">Cancel</Button>
          <Button type="submit" :disabled="busy || !name.trim()">
            <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>
            Save {{ kind }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { create_from_spec } from '@/lib/datasets/api.js'
import { repeats_rows } from '@/lib/datasets/compare.js'

const emit = defineEmits(['saved'])
const ds = useDatasetsStore()
const router = useRouter()

const open_ = ref(false)
const kind = ref('process')
const items = ref([])
const name = ref('')
const busy = ref(false)
const error = ref(null)

const repeats = computed(() => open_.value && repeats_rows(items.value, ds.byUuid))

function open (k, uuids) {
  kind.value = k === 'part' ? 'part' : 'process'
  items.value = [...uuids]
  name.value = ''
  error.value = null
  open_.value = true
}

function close () {
  if (!busy.value) open_.value = false
}

// What an earlier attempt made, so a retry does not make it again.
const progress = {}

async function save () {
  if (!name.value.trim()) return
  busy.value = true
  error.value = null
  try {
    const sc = useServiceClientStore()
    const uuid = await create_from_spec(sc.client, {
      name: name.value.trim(),
      kind: kind.value,
      items: items.value,
      window: null,
      createdBy: sc.username,
    }, progress)
    toast.success(`${kind.value === 'part' ? 'Part' : 'Process'} saved`)
    open_.value = false
    emit('saved', uuid)
    router.push(`/datasets/${uuid}`)
  }
  catch (err) {
    error.value = { message: err.message ?? 'Not saved.', detail: err.detail ?? null }
  }
  finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>
