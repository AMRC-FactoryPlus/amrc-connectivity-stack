<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@store/layoutStore.js'
import { useVisualiserStore } from '@store/useVisualiserStore.js'
import { createScene } from '@/lib/visualiser/scene.js'
import { computeLayout } from '@/lib/visualiser/graph.js'
import { createNodes } from '@/lib/visualiser/nodes.js'
import { createEdges } from '@/lib/visualiser/edges.js'

const canvas = ref(null)
const layout = useLayoutStore()
const store = useVisualiserStore()
let sceneCtx = null
let nodesCtx = null
let edgesCtx = null
let positions = null

onMounted(async () => {
  layout.toggleFullscreen(true)
  sceneCtx = createScene(canvas.value)

  await store.loadTree()
  positions = computeLayout(store.nodes, store.rootIds)

  nodesCtx = createNodes(sceneCtx.scene)
  nodesCtx.build(store.nodes, positions)

  edgesCtx = createEdges(sceneCtx.scene)
  edgesCtx.build(store.nodes, positions)

  sceneCtx.onUpdate((dt) => {
    nodesCtx.update(dt, store.values)
  })

  sceneCtx.start()
  await store.startStreaming()
})

onBeforeUnmount(async () => {
  if (edgesCtx) edgesCtx.dispose()
  if (nodesCtx) nodesCtx.dispose()
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
