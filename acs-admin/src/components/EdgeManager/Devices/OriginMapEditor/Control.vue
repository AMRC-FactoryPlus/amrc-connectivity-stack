<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col gap-0.5">
    <div class="flex items-center gap-1 mb-1">
      <label v-if="label" class="text-sm font-semibold text-gray-700">{{ label }}</label>
      <Dialog v-if="help">
        <DialogTrigger asChild>
          <i class="fa-solid fa-question-circle text-xs text-gray-400/50 mr-1 cursor-help hover:text-gray-600 dark:hover:text-gray-300"></i>
        </DialogTrigger>
        <DialogContent class="sm:max-w-md">
          <DialogHeader>
            <DialogTitle class="mb-2">Help</DialogTitle>
            <DialogDescription>
              {{ help }}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
    <slot></slot>
  </div>
</template>

<script setup>
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

defineProps({
  label: {
    type: String,
  },
  help: {
    type: String,
    required: false
  }
})
</script>
