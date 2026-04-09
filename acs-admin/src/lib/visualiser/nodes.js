/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  RADIUS_ROOT, RADIUS_AREA, RADIUS_DEVICE, RADIUS_LEAF,
  COLOUR_GOOD, COLOUR_UNCERTAIN, COLOUR_BAD, COLOUR_STALE,
} from './constants.js'

const DEPTH_CONFIG = [
  { radius: RADIUS_ROOT, emissive: 0.8 },     // depth 0: root/enterprise
  { radius: RADIUS_AREA, emissive: 0.5 },      // depth 1: site/area
  { radius: RADIUS_AREA * 0.8, emissive: 0.4 },// depth 2: work centre
  { radius: RADIUS_DEVICE, emissive: 0.3 },    // depth 3: device
]
const LEAF_CONFIG = { radius: RADIUS_LEAF, emissive: 0.6 }

const QUALITY_COLOURS = {
  Good: new THREE.Color(COLOUR_GOOD),
  GoodNoData: new THREE.Color(COLOUR_GOOD).multiplyScalar(0.5),
  Uncertain: new THREE.Color(COLOUR_UNCERTAIN),
  Bad: new THREE.Color(COLOUR_BAD),
}
const DEFAULT_COLOUR = new THREE.Color(COLOUR_STALE)

/**
 * Create and manage instanced node meshes.
 */
export function createNodes (scene) {
  const meshes = []
  const instanceMap = new Map()  // elementId -> { mesh, index }

  // Shared geometry
  const sphere = new THREE.SphereGeometry(1, 16, 12)
  const dummy = new THREE.Object3D()
  const colour = new THREE.Color()

  function build (storeNodes, positions) {
    // Remove old meshes
    for (const m of meshes) {
      scene.remove(m)
      m.dispose()
    }
    meshes.length = 0
    instanceMap.clear()

    // Group nodes by depth bucket
    const groups = new Map()  // depth -> [{ id, pos }]

    for (const [id, entry] of storeNodes) {
      const pos = positions.get(id)
      if (!pos) continue

      const isLeaf = entry.childIds.length === 0
      const key = isLeaf ? 'leaf' : Math.min(entry.depth, 3)

      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ id, pos })
    }

    // Create one InstancedMesh per group
    for (const [key, items] of groups) {
      const config = key === 'leaf' ? LEAF_CONFIG : DEPTH_CONFIG[key]
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: COLOUR_GOOD,
        emissiveIntensity: config.emissive,
        transparent: true,
        opacity: 0.9,
      })

      const mesh = new THREE.InstancedMesh(sphere, material, items.length)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

      // Per-instance colour
      const colours = new Float32Array(items.length * 3)
      DEFAULT_COLOUR.toArray(colours, 0)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colours, 3)

      for (let i = 0; i < items.length; i++) {
        const { id, pos } = items[i]
        dummy.position.copy(pos)
        dummy.scale.setScalar(config.radius)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        mesh.setColorAt(i, DEFAULT_COLOUR)

        instanceMap.set(id, { mesh, index: i })
      }

      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
      scene.add(mesh)
      meshes.push(mesh)
    }
  }

  // Brightness flash tracking
  const flashes = new Map()  // elementId -> remaining seconds

  const WHITE = new THREE.Color(0xffffff)

  function update (dt, storeValues) {
    // Decay flashes
    for (const [id, remaining] of flashes) {
      const next = remaining - dt
      if (next <= 0) {
        flashes.delete(id)
      } else {
        flashes.set(id, next)
      }
    }

    // Track which meshes need a GPU upload
    const dirtyMeshes = new Set()

    // Update colours from values
    for (const [elementId, vqt] of storeValues) {
      const inst = instanceMap.get(elementId)
      if (!inst) continue

      const base = QUALITY_COLOURS[vqt.quality] ?? DEFAULT_COLOUR
      colour.copy(base)

      // Brighten on recent update
      const flash = flashes.get(elementId)
      if (flash) {
        colour.lerp(WHITE, flash)
      }

      inst.mesh.setColorAt(inst.index, colour)
      dirtyMeshes.add(inst.mesh)
    }

    // Single GPU upload per mesh, not per instance
    for (const mesh of dirtyMeshes) {
      mesh.instanceColor.needsUpdate = true
    }
  }

  function flash (elementId) {
    flashes.set(elementId, 0.3)
  }

  function dispose () {
    for (const m of meshes) {
      scene.remove(m)
      m.geometry.dispose()
      m.material.dispose()
    }
  }

  return { build, update, flash, dispose, instanceMap }
}
