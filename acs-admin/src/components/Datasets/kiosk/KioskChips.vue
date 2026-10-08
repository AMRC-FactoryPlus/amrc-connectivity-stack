<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One-tap choice chips, 44px tall. `options` are strings or
     { id, label, help }; v-model holds the chosen id. -->
<template>
  <div class="flex flex-wrap gap-2" role="radiogroup">
    <button v-for="o in items" :key="o.id" type="button" role="radio" :aria-checked="o.id === modelValue"
            class="flex min-h-11 flex-col items-start justify-center rounded-md border px-4 py-2 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
            :class="[o.id === modelValue ? 'border-slate-900 bg-slate-900 text-slate-50' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-100', wide ? 'basis-[calc(50%-0.25rem)] min-h-[72px]' : '']"
            @click="emit('update:modelValue', o.id)">
      <span class="font-medium">{{ o.label }}</span>
      <span v-if="o.help" class="text-xs font-normal opacity-75">{{ o.help }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  options: { type: Array, required: true },
  modelValue: { type: String, default: null },
  wide: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const items = computed(() => props.options.map(o => typeof o === 'string' ? { id: o, label: o } : o))
</script>
