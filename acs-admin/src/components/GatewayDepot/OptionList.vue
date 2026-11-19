<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- A choice of one option from a short list, each with a line of
     detail. The options may change under the person as the gateway
     reports; the choice is the caller's, so it stays put. -->
<template>
  <fieldset class="flex min-w-0 flex-col gap-1.5" :data-invalid="error ? 'true' : null">
    <legend class="mb-2 text-sm font-medium">{{ legend }}</legend>
    <div class="flex flex-col gap-1.5">
      <label v-for="o in options" :key="o.value"
          class="flex flex-wrap items-start gap-x-2.5 gap-y-1 rounded-md border px-3 py-2.5 text-sm"
          :class="[
            modelValue === o.value ? 'border-slate-900' : 'border-slate-200',
            o.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50',
          ]">
        <input type="radio" class="mt-0.5 size-4 shrink-0 accent-slate-900" :name="name" :value="o.value"
            :checked="modelValue === o.value" :disabled="o.disabled"
            @change="$emit('update:modelValue', o.value)">
        <span class="min-w-0 flex-1 basis-40 break-words">
          <span class="block font-semibold" :class="o.mono ? 'font-mono' : ''">{{ o.title }}</span>
          <span v-if="o.detail" class="block text-slate-500">{{ o.detail }}</span>
        </span>
        <span v-if="o.hint" class="basis-full pl-[1.625rem] text-xs text-slate-500">{{ o.hint }}</span>
      </label>
    </div>
    <p v-if="info" class="text-xs text-gray-500">{{ info }}</p>
    <p v-if="error" class="text-xs font-medium text-red-500" role="alert">{{ error }}</p>
  </fieldset>
</template>

<script setup>
import { useId } from 'vue'

defineProps({
  legend: { type: String, required: true },
  /* [{ value, title, detail, hint, disabled, mono }] */
  options: { type: Array, required: true },
  modelValue: { type: String, default: null },
  info: { type: String, default: null },
  error: { type: String, default: null },
})
defineEmits(['update:modelValue'])

const name = useId()
</script>
