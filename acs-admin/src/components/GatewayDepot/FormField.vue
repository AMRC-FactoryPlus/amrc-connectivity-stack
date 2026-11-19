<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- A labelled form control with its help text and its error. -->
<template>
  <div class="flex min-w-0 flex-col gap-1.5" :data-invalid="error || invalid ? 'true' : null">
    <label class="flex flex-col gap-2">
      <span class="text-sm font-medium">{{ label }}<span v-if="optional" class="font-normal text-slate-500"> (optional)</span></span>
      <slot></slot>
    </label>
    <p v-if="info" class="text-xs text-gray-500">{{ info }}</p>
    <slot name="after"></slot>
    <p v-if="error" class="text-xs font-medium text-red-500" role="alert">{{ error }}</p>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  optional: { type: Boolean, default: false },
  info: { type: String, default: null },
  error: { type: String, default: null },
  /* The control shows its own error; this only marks the field. */
  invalid: { type: Boolean, default: false },
})
</script>
