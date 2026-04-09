<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@store/layoutStore.js'
import { useVisualiserStore } from '@store/useVisualiserStore.js'
import { createScene } from '@/lib/visualiser/scene.js'

const canvas = ref(null)
const layout = useLayoutStore()
const store = useVisualiserStore()
let sceneCtx = null

onMounted(async () => {
  layout.toggleFullscreen(true)
  sceneCtx = createScene(canvas.value)
  sceneCtx.start()

  await store.loadTree()
  console.log(`Visualiser: loaded ${store.nodes.size} nodes, ${store.leafIds.length} leaves`)

  await store.startStreaming()
  console.log('Visualiser: SSE streaming started')
})

onBeforeUnmount(async () => {
  if (sceneCtx) sceneCtx.dispose()
  await store.cleanup()
  layout.toggleFullscreen(false)
})
</script>

<template>
  <div class="fixed inset-0 bg-[#0a0a1a]">
    <canvas ref="canvas" class="w-full h-full block" />
  </div>
</template>
