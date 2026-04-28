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
let cameraCtrl = null
const seenValues = new Map()

// HUD state
const hudTargetId = ref(null)
const hudPhase = ref(null)
const hudDeviceName = ref(null)
const hudDeviceHierarchy = ref([])

// Expanded device state
let expandedDeviceId = null
let expandedNodeIds = new Set()
let expandedNodesCtx = null
let expandedEdgesCtx = null
let expandedParticlesCtx = null
let expandedLodCtx = null
let inTour = false

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

  cameraCtrl = createCameraController(sceneCtx.camera, canvas.value, positions, () => {
    return [...store.values.keys()]
  }, {
    async onSweepIn (deviceId) {
      const name = store.nodes.get(deviceId)?.node?.displayName ?? deviceId.slice(0, 8)
      console.log(`Sweep in: ${name}`)

      // Set device context for HUD
      const deviceEntry = store.nodes.get(deviceId)
      hudDeviceName.value = deviceEntry?.node?.displayName ?? name
      const path = []
      let cur = deviceEntry?.parentId
      while (cur) {
        const e = store.nodes.get(cur)
        if (!e) break
        path.unshift(e.node?.displayName ?? cur.slice(0, 8))
        cur = e.parentId
      }
      hudDeviceHierarchy.value = path

      // Hide main graph completely during tour
      nodesCtx.setOpacity(0)
      edgesCtx.setOpacity(0)
      lodCtx.setOpacity(0)
      particlesCtx.setVisible(false)
      inTour = true

      // Expand device subtree
      const { nodes: expandedNodes, leafIds, activeLeafId } = await store.expandDevice(deviceId)
      if (expandedNodes.size === 0) return

      expandedDeviceId = deviceId
      expandedNodeIds = new Set(expandedNodes.keys())

      // Compute positions for expanded nodes
      const devicePos = positions.get(deviceId)
      if (!devicePos) return

      const miniRenderable = new Map()
      miniRenderable.set(deviceId, store.nodes.get(deviceId))
      for (const [id, entry] of expandedNodes) {
        miniRenderable.set(id, entry)
      }
      const miniPositions = computeLayout(miniRenderable, [deviceId])

      const expandedPositions = new Map()
      for (const [id, pos] of miniPositions) {
        if (id === deviceId) continue
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

      // Labels for ALL expanded nodes
      expandedLodCtx = createLOD(sceneCtx.scene, expandedNodes, expandedPositions, { labelAll: true })

      // Expanded particles for leaf-level emission
      expandedParticlesCtx = createParticles(sceneCtx.scene)

      // Build tour stops from active leaves that have positions
      const activeStops = []
      for (const leafId of leafIds) {
        const pos = positions.get(leafId)
        if (pos) {
          activeStops.push({ id: leafId, pos })
        }
      }

      // Prefer leaves with data, limit to 10
      activeStops.sort((a, b) => {
        return (store.updateCounts.get(b.id) || 0) - (store.updateCounts.get(a.id) || 0)
      })

      console.log(`Expanded ${name}: ${expandedNodes.size} nodes, ${activeStops.length} tour stops`)
      cameraCtrl.setTourStops(activeStops)
    },

    onTourStop (leafId) {
      // Update HUD to show this leaf
      hudTargetId.value = leafId
      const entry = store.nodes.get(leafId)
      console.log(`Tour stop: ${entry?.node?.displayName ?? leafId.slice(0, 8)}`)
    },

    onSweepOut (deviceId) {
      console.log(`Sweep out: ${store.nodes.get(deviceId)?.node?.displayName ?? deviceId.slice(0, 8)}`)

      // Restore main graph and particles
      nodesCtx.setOpacity(0.95)
      edgesCtx.setOpacity(0.5)
      lodCtx.setOpacity(0.5)
      particlesCtx.setVisible(true)
      inTour = false

      // Remove expanded
      if (expandedLodCtx) { expandedLodCtx.dispose(); expandedLodCtx = null }
      if (expandedNodesCtx) { expandedNodesCtx.dispose(); expandedNodesCtx = null }
      if (expandedEdgesCtx) { expandedEdgesCtx.dispose(); expandedEdgesCtx = null }
      if (expandedParticlesCtx) { expandedParticlesCtx.dispose(); expandedParticlesCtx = null }

      for (const id of expandedNodeIds) {
        positions.delete(id)
      }
      if (expandedDeviceId) {
        store.collapseDevice(expandedDeviceId, expandedNodeIds)
      }
      expandedDeviceId = null
      expandedNodeIds = new Set()
      hudPhase.value = null
      hudTargetId.value = null
      hudDeviceName.value = null
      hudDeviceHierarchy.value = []
    },
  })

  sceneCtx.onUpdate((dt) => {
    cameraCtrl.update(dt)

    // Emit particles
    let _emitDebugOnce = window._emitDebugDone ? false : true
    for (const [id, vqt] of store.values) {
      const prev = seenValues.get(id)
      if (prev !== vqt.timestamp) {
        seenValues.set(id, vqt.timestamp)

        if (inTour) {
          // During tour - emit from expanded leaves OR device
          const hasPos = positions.has(id)
          const isExpanded = expandedNodeIds.has(id)
          if (_emitDebugOnce) {
            console.log(`Tour emit: id=${id.slice(0,8)} hasPos=${hasPos} isExpanded=${isExpanded} expandedCount=${expandedNodeIds.size}`)
            window._emitDebugDone = true
            _emitDebugOnce = false
          }
          if (hasPos && expandedParticlesCtx) {
            expandedParticlesCtx.emit(id, vqt.quality, store.nodes, positions, (nodeId) => {
              if (expandedNodesCtx) expandedNodesCtx.flash(nodeId)
            })
          }
        } else {
          if (!positions.has(id)) continue
          particlesCtx.emit(id, vqt.quality, renderable, positions, (nodeId) => {
            nodesCtx.flash(nodeId)
          })
        }
      }
    }

    nodesCtx.update(dt, store.values)
    if (expandedNodesCtx) expandedNodesCtx.update(dt, store.values)
    particlesCtx.update(dt)
    if (expandedParticlesCtx) expandedParticlesCtx.update(dt)
    lodCtx.update(sceneCtx.camera, dt, null, null)

    // Update HUD
    const sweep = cameraCtrl.getSweepState()
    if (sweep) {
      hudPhase.value = sweep.phase
      if (sweep.tourStopId) {
        hudTargetId.value = sweep.tourStopId
      }
    } else if (hudPhase.value) {
      hudPhase.value = null
    }
  })

  sceneCtx.start()
  await store.startStreaming()
})

onBeforeUnmount(async () => {
  if (expandedLodCtx) expandedLodCtx.dispose()
  if (expandedParticlesCtx) expandedParticlesCtx.dispose()
  if (expandedNodesCtx) expandedNodesCtx.dispose()
  if (expandedEdgesCtx) expandedEdgesCtx.dispose()
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
      :device-name="hudDeviceName"
      :device-hierarchy="hudDeviceHierarchy"
    />
  </div>
</template>
