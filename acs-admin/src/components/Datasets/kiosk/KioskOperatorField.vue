<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- A name field with one-tap recent names (44px buttons). -->
<template>
  <div class="flex flex-col gap-2">
    <label :for="id" class="text-[15px] font-medium text-slate-900">Your name</label>
    <input :id="id" ref="input" :value="modelValue" type="text" autocomplete="off" enterkeyhint="done"
           placeholder="Type your name"
           class="h-14 w-full rounded-md border border-slate-200 bg-white px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
           @input="e => emit('update:modelValue', e.target.value)" @keydown.enter.prevent="emit('submit')"/>
    <div v-if="recent.length" class="flex flex-wrap gap-1.5">
      <button v-for="n in recent" :key="n" type="button"
              class="h-11 rounded-md px-3.5 text-[15px] ring-1 transition-colors"
              :class="n === modelValue ? 'bg-slate-900 text-slate-50 ring-slate-900' : 'bg-white ring-slate-200 hover:bg-slate-100'"
              @click="emit('update:modelValue', n)">
        <i class="fa-solid fa-user mr-1.5 text-xs opacity-70"></i>{{ n }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  recent: { type: Array, default: () => [] },
  autofocus: { type: Boolean, default: false },
  id: { type: String, default: 'kiosk-operator' },
})
const emit = defineEmits(['update:modelValue', 'submit'])

const input = ref(null)
onMounted(() => { if (props.autofocus && !props.recent.length) input.value?.focus() })
</script>
