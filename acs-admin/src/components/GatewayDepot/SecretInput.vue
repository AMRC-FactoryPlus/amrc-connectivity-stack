<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- A secret that is used once, such as a join token. The browser and
     password managers are told not to offer to save or fill it. The
     caller holds the value in memory and nowhere else. -->
<template>
  <div class="flex gap-2">
    <input :type="shown ? 'text' : 'password'" :value="modelValue" :name="name"
        autocomplete="one-time-code" autocapitalize="none" autocorrect="off" spellcheck="false"
        data-1p-ignore="true" data-lpignore="true" data-bwignore="true" data-form-type="other"
        class="flex h-10 w-full min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:text-sm"
        :class="invalid ? 'border-red-500' : ''"
        @input="$emit('update:modelValue', $event.target.value)">
    <Button type="button" variant="outline" :aria-pressed="shown" @click="shown = !shown">{{ shown ? 'Hide' : 'Show' }}</Button>
  </div>
</template>

<script setup>
import { ref, useId } from 'vue'
import { Button } from '@/components/ui/button'

defineProps({
  modelValue: { type: String, default: '' },
  invalid: { type: Boolean, default: false },
})
defineEmits(['update:modelValue'])

const shown = ref(false)
/* A name no password manager has seen before. */
const name = 'once-' + useId()
</script>
