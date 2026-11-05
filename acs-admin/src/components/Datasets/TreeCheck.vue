<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- A tick box that can also be part-ticked, for a level of the device
     picker's tree. `state` is all, some, none or disabled (nothing under
     it can be chosen). Emits `toggle`. -->
<template>
  <button type="button" role="checkbox" :aria-checked="state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'"
          :aria-label="label" :disabled="disabled || state === 'disabled'"
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded border text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-50"
          :class="state === 'all' || state === 'some' ? 'border-slate-900 bg-slate-900' : 'border-slate-300 bg-white'"
          @click="emit('toggle')">
    <i v-if="state === 'all'" class="fa-solid fa-check text-[10px]"></i>
    <i v-else-if="state === 'some'" class="fa-solid fa-minus text-[10px]"></i>
  </button>
</template>

<script setup>
defineProps({
  state: { type: String, default: 'none' },
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle'])
</script>
