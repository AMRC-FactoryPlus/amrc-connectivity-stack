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
import { createLOD } from '@/lib/visualiser/lod.js'
import { createSparklines } from '@/lib/visualiser/sparklines.js'

const canvas = ref(null)
const layout = useLayoutStore()
const store = useVisualiserStore()
let sceneCtx = null
let nodesCtx = null
let edgesCtx = null
let particlesCtx = null
let lodCtx = null
let sparklinesCtx = null
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

  const cameraCtrl = createCameraController(sceneCtx.camera, positions, () => {
    // Return IDs of leaf nodes that have received live data
    return [...store.values.keys()]
  })
  particlesCtx = createParticles(sceneCtx.scene)
  lodCtx = createLOD(sceneCtx.scene, store.nodes, positions)
  sparklinesCtx = createSparklines(sceneCtx.scene)

  sceneCtx.onUpdate((dt) => {
    cameraCtrl.update(dt)

    // Check for new SSE values and emit particles
    let emitted = 0
    for (const [id, vqt] of store.values) {
      const prev = seenValues.get(id)
      if (prev !== vqt.timestamp) {
        seenValues.set(id, vqt.timestamp)
        const result = particlesCtx.emit(id, vqt.quality, store.nodes, positions, (nodeId) => {
          nodesCtx.flash(nodeId)
        })
        emitted++
      }
    }
    if (emitted > 0 && !window._particleLogThrottle) {
      console.log(`Visualiser: emitted ${emitted} particles, values=${store.values.size}`)
      window._particleLogThrottle = true
      setTimeout(() => { window._particleLogThrottle = false }, 2000)
    }

    nodesCtx.update(dt, store.values)
    particlesCtx.update(dt)
    lodCtx.update(
      sceneCtx.camera,
      dt,
      (id) => {
        // Create an empty history entry so live SSE values get appended
        if (!store.history.has(id)) {
          store.history.set(id, { points: [], fetching: false, lastFetch: 0 })
        }
        const pos = positions.get(id)
        if (pos) sparklinesCtx.show(id, pos)
      },
      (id) => {
        sparklinesCtx.hide(id)
      },
    )
    sparklinesCtx.update(sceneCtx.camera, store.history, store.values)
  })

  sceneCtx.start()
  await store.startStreaming()
})

onBeforeUnmount(async () => {
  if (sparklinesCtx) sparklinesCtx.dispose()
  if (lodCtx) lodCtx.dispose()
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
    <div v-if="!store.loaded" class="absolute inset-0 flex items-center justify-center">
      <p class="text-white/50 text-sm">Loading hierarchy...</p>
    </div>
  </div>
</template>
