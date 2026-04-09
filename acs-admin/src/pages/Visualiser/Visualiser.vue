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
import { createCameraController } from '@/lib/visualiser/camera.js'
import { createParticles } from '@/lib/visualiser/particles.js'

const canvas = ref(null)
const layout = useLayoutStore()
const store = useVisualiserStore()
let sceneCtx = null
let nodesCtx = null
let edgesCtx = null
let particlesCtx = null
let positions = null
const seenValues = new Map()

onMounted(async () => {
  layout.toggleFullscreen(true)
  sceneCtx = createScene(canvas.value)

  await store.loadTree()
  positions = computeLayout(store.nodes, store.rootIds)

  nodesCtx = createNodes(sceneCtx.scene)
  nodesCtx.build(store.nodes, positions)

  edgesCtx = createEdges(sceneCtx.scene)
  edgesCtx.build(store.nodes, positions)

  const cameraCtrl = createCameraController(sceneCtx.camera, positions)
  particlesCtx = createParticles(sceneCtx.scene)

  sceneCtx.onUpdate((dt) => {
    cameraCtrl.update(dt)

    // Check for new SSE values and emit particles
    for (const [id, vqt] of store.values) {
      const prev = seenValues.get(id)
      if (prev !== vqt.timestamp) {
        seenValues.set(id, vqt.timestamp)
        particlesCtx.emit(id, vqt.quality, store.nodes, positions, (nodeId) => {
          nodesCtx.flash(nodeId)
        })
      }
    }

    nodesCtx.update(dt, store.values)
    particlesCtx.update(dt)
  })

  sceneCtx.start()
  await store.startStreaming()
})

onBeforeUnmount(async () => {
  if (particlesCtx) particlesCtx.dispose()
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
