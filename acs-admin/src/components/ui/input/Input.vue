<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup>
import { useVModel } from '@vueuse/core'
import { cn } from '@/lib/utils'

const props = defineProps({
  defaultValue: {
    type: [String, Number],
    required: false,
  },
  modelValue: {
    type: [String, Number],
    required: false,
  },
  class: {
    type: null,
    required: false,
  },
  v: {
    type: Object,
    required: false,
  },
  title: {
    type: String,
    required: false,
  },
  placeholder: {
    type: String,
    required: false,
  },
})

const emits = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <div class="w-full flex flex-col gap-1">
    <div class="flex items-center justify-between gap-2">
      <label class="text-sm font-medium" v-if="title" :for="title">{{title}}</label>
      <div v-if="v && v.$invalid && v.$dirty" class="text-xs text-red-500">
        {{v.$silentErrors[0]?.$message}}
      </div>
    </div>
    <input
        :name="title"
        v-model="modelValue"
        :placeholder
        :class="
      cn(
        'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:ring-offset-slate-950 dark:placeholder:text-slate-400 dark:focus-visible:ring-slate-300',
        props.class,
        {
          'border-red-500': v?.$invalid,
        }
      )
    "
    />
  </div>
</template>
