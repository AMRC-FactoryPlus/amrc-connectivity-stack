<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { Button } from '@/components/ui/button'
import { useMonitorStore } from '@store/useMonitorStore.js'

const monitor = useMonitorStore()

function handleClick () {
  if (monitor.dialogOpen) {
    monitor.closeDialog()
  } else {
    monitor.openDialog()
  }
}
</script>

<template>
  <Button variant="ghost" size="icon" title="Monitored Items" @click="handleClick" class="relative">
    <i class="fa-solid fa-eye"></i>
    <span
      v-if="monitor.newCount > 0"
      class="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
    >
      {{ monitor.newCount > 99 ? '99+' : monitor.newCount }}
    </span>
  </Button>
</template>
