<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@store/layoutStore.js'

const canvas = ref(null)
const layout = useLayoutStore()

onMounted(() => {
  layout.toggleFullscreen(true)
})

onBeforeUnmount(() => {
  layout.toggleFullscreen(false)
})
</script>

<template>
  <div class="fixed inset-0 bg-[#0a0a1a]">
    <canvas ref="canvas" class="w-full h-full" />
  </div>
</template>
