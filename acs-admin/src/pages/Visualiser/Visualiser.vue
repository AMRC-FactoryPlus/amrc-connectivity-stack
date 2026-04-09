<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@store/layoutStore.js'
import { createScene } from '@/lib/visualiser/scene.js'

const canvas = ref(null)
const layout = useLayoutStore()
let sceneCtx = null

onMounted(() => {
  layout.toggleFullscreen(true)
  sceneCtx = createScene(canvas.value)
  sceneCtx.start()
})

onBeforeUnmount(() => {
  if (sceneCtx) sceneCtx.dispose()
  layout.toggleFullscreen(false)
})
</script>

<template>
  <div class="fixed inset-0 bg-[#0a0a1a]">
    <canvas ref="canvas" class="w-full h-full block" />
  </div>
</template>
