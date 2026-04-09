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

// Expanded device state
let expandedDeviceId = null
let expandedNodeIds = new Set()
let expandedNodesCtx = null
let expandedEdgesCtx = null

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
    async onSweepIn (deviceId) {
      const name = store.nodes.get(deviceId)?.node?.displayName ?? deviceId.slice(0, 8)
      console.log(`Sweep in: ${name}`)

      // Expand the device subtree
      const { nodes: expandedNodes, leafIds, activeLeafId } = await store.expandDevice(deviceId)
      if (expandedNodes.size === 0) return

      expandedDeviceId = deviceId
      expandedNodeIds = new Set(expandedNodes.keys())

      // Compute positions for expanded nodes around the device
      const devicePos = positions.get(deviceId)
      if (!devicePos) return

      // Build a mini position map: device + its expanded children
      const expandedPositions = new Map()
      expandedPositions.set(deviceId, devicePos)

      // Layout expanded nodes in a small cluster around the device
      const miniRenderable = new Map()
      miniRenderable.set(deviceId, store.nodes.get(deviceId))
      for (const [id, entry] of expandedNodes) {
        miniRenderable.set(id, entry)
      }
      const miniPositions = computeLayout(miniRenderable, [deviceId])

      // Offset all mini positions to be centred on the device's world position
      for (const [id, pos] of miniPositions) {
        if (id === deviceId) continue
        // Scale down the expanded cluster to fit near the device
        pos.multiplyScalar(0.3)
        pos.add(devicePos)
        positions.set(id, pos)
        expandedPositions.set(id, pos)
      }

      // Render expanded nodes and edges
      expandedNodesCtx = createNodes(sceneCtx.scene)
      expandedNodesCtx.build(expandedNodes, expandedPositions)

      expandedEdgesCtx = createEdges(sceneCtx.scene)
      expandedEdgesCtx.build(expandedNodes, expandedPositions)

      // Set HUD to the most active leaf
      if (activeLeafId) {
        hudTargetId.value = activeLeafId
      }

      // Dim the main graph
      nodesCtx.setOpacity(0.1)
      edgesCtx.setOpacity(0.05)
      lodCtx.setOpacity(0.1)

      console.log(`Expanded ${name}: ${expandedNodes.size} nodes, active leaf: ${activeLeafId?.slice(0, 8)}`)
    },

    onSweepOut (deviceId) {
      console.log(`Sweep out: ${store.nodes.get(deviceId)?.node?.displayName ?? deviceId.slice(0, 8)}`)

      // Restore main graph opacity
      nodesCtx.setOpacity(0.95)
      edgesCtx.setOpacity(0.5)
      lodCtx.setOpacity(0.5)

      // Remove expanded nodes
      if (expandedNodesCtx) {
        expandedNodesCtx.dispose()
        expandedNodesCtx = null
      }
      if (expandedEdgesCtx) {
        expandedEdgesCtx.dispose()
        expandedEdgesCtx = null
      }

      for (const id of expandedNodeIds) {
        positions.delete(id)
      }

      if (expandedDeviceId) {
        store.collapseDevice(expandedDeviceId, expandedNodeIds)
      }
      expandedDeviceId = null
      expandedNodeIds = new Set()
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
    if (expandedNodesCtx) expandedNodesCtx.update(dt, store.values)
    particlesCtx.update(dt)
    lodCtx.update(sceneCtx.camera, dt, null, null)

    // Update HUD state
    const sweep = cameraCtrl.getSweepState()
    if (sweep) {
      // During hold, hudTargetId may have been set to an active leaf by onSweepIn
      hudPhase.value = sweep.phase
    } else if (hudPhase.value) {
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
