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
import HudOverlay from './HudOverlay.vue'

const canvas = ref(null)
const layout = useLayoutStore()
const store = useVisualiserStore()
let sceneCtx = null
let nodesCtx = null
let edgesCtx = null
let particlesCtx = null
let lodCtx = null
let positions = null
const seenValues = new Map()

// HUD state
const hudTargetId = ref(null)
const hudPhase = ref(null)

onMounted(async () => {
  layout.toggleFullscreen(true)
  sceneCtx = createScene(canvas.value)

  await store.loadTree()

  const renderable = store.renderableNodes
  positions = computeLayout(renderable, store.rootIds)

  nodesCtx = createNodes(sceneCtx.scene)
  nodesCtx.build(renderable, positions)

  edgesCtx = createEdges(sceneCtx.scene)
  edgesCtx.build(renderable, positions)

  particlesCtx = createParticles(sceneCtx.scene)
  lodCtx = createLOD(sceneCtx.scene, renderable, positions)

  const cameraCtrl = createCameraController(sceneCtx.camera, canvas.value, positions, () => {
    return [...store.values.keys()]
  }, {
    onSweepIn (deviceId) {
      console.log(`Sweep in: ${store.nodes.get(deviceId)?.node?.displayName ?? deviceId.slice(0,8)}`)
      // TODO: expand device subtree, render child nodes, pick active leaf for HUD
    },
    onSweepOut (deviceId) {
      console.log(`Sweep out: ${store.nodes.get(deviceId)?.node?.displayName ?? deviceId.slice(0,8)}`)
      // TODO: collapse device subtree, remove child nodes
      hudPhase.value = null
    },
  })

  sceneCtx.onUpdate((dt) => {
    cameraCtrl.update(dt)

    // Emit particles for new SSE values
    for (const [id, vqt] of store.values) {
      const prev = seenValues.get(id)
      if (prev !== vqt.timestamp) {
        seenValues.set(id, vqt.timestamp)
        if (!positions.has(id)) continue
        particlesCtx.emit(id, vqt.quality, renderable, positions, (nodeId) => {
          nodesCtx.flash(nodeId)
        })
      }
    }

    nodesCtx.update(dt, store.values)
    particlesCtx.update(dt)
    lodCtx.update(sceneCtx.camera, dt, null, null)

    // Update HUD state
    const sweep = cameraCtrl.getSweepState()
    if (sweep) {
      hudTargetId.value = sweep.targetId
      hudPhase.value = sweep.phase
    } else if (hudPhase.value && hudPhase.value !== 'ease-out') {
      hudPhase.value = null
    }
  })

  sceneCtx.start()
  await store.startStreaming()
})

onBeforeUnmount(async () => {
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
  <div class="fixed inset-0 bg-black">
    <canvas ref="canvas" class="w-full h-full block" />
    <div v-if="!store.loaded" class="absolute inset-0 flex items-center justify-center">
      <p class="text-white/50 text-sm">Loading hierarchy...</p>
    </div>
    <HudOverlay
      :target-id="hudTargetId"
      :phase="hudPhase"
      :nodes="store.nodes"
      :values="store.values"
    />
  </div>
</template>
