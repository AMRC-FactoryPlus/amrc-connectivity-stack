<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Who is using the tablet. The tablet signs in as one account, so the
     operator types a name or taps a recent one. -->
<template>
  <Dialog :open="open" @update:open="v => !v && emit('close')">
    <DialogContent class="text-base sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="text-xl">Who is recording?</DialogTitle>
        <DialogDescription>Your name goes on the recordings you start on this tablet.</DialogDescription>
      </DialogHeader>
      <KioskOperatorField v-model="name" :recent="recent" autofocus @submit="save"/>
      <DialogFooter class="gap-2">
        <Button variant="outline" class="h-12 px-6 text-base" @click="emit('close')">Cancel</Button>
        <Button class="h-12 px-6 text-base" :disabled="!name.trim()" @click="save">Save</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import KioskOperatorField from './KioskOperatorField.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  current: { type: String, default: '' },
  recent: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'save'])

const name = ref('')
watch(() => props.open, v => { if (v) name.value = props.current })

function save () {
  if (!name.value.trim()) return
  emit('save', name.value.trim())
}
</script>
