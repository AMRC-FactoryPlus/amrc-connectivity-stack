/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  RADIUS_ROOT, RADIUS_AREA, RADIUS_DEVICE, RADIUS_LEAF,
  COLOUR_GOOD, COLOUR_UNCERTAIN, COLOUR_BAD, COLOUR_STALE,
  COLOUR_NODE_BRIGHT,
} from './constants.js'

const DEPTH_CONFIG = [
  { radius: RADIUS_ROOT, emissive: 2.0 },     // depth 0: bright hub
  { radius: RADIUS_AREA, emissive: 1.5 },
  { radius: RADIUS_AREA * 0.8, emissive: 1.2 },
  { radius: RADIUS_DEVICE, emissive: 1.0 },
]
const LEAF_CONFIG = { radius: RADIUS_LEAF, emissive: 0.8 }

const QUALITY_COLOURS = {
  Good: new THREE.Color(COLOUR_NODE_BRIGHT),
  GoodNoData: new THREE.Color(COLOUR_GOOD).multiplyScalar(0.5),
  Uncertain: new THREE.Color(COLOUR_UNCERTAIN),
  Bad: new THREE.Color(COLOUR_BAD),
}
const DEFAULT_COLOUR = new THREE.Color(COLOUR_STALE)

export function createNodes (scene) {
  const meshes = []
  const instanceMap = new Map()

  const sphere = new THREE.SphereGeometry(1, 12, 8)
  const dummy = new THREE.Object3D()
  const colour = new THREE.Color()
  const WHITE = new THREE.Color(0xffffff)

  function build (storeNodes, positions) {
    for (const m of meshes) {
      scene.remove(m)
      m.dispose()
    }
    meshes.length = 0
    instanceMap.clear()

    const groups = new Map()

    for (const [id, entry] of storeNodes) {
      const pos = positions.get(id)
      if (!pos) continue

      const isLeaf = entry.childIds.length === 0
      const key = isLeaf ? 'leaf' : Math.min(entry.depth, 3)

      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ id, pos })
    }

    for (const [key, items] of groups) {
      const config = key === 'leaf' ? LEAF_CONFIG : DEPTH_CONFIG[key]

      // Emissive material - self-illuminating points that glow with bloom
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOUR_NODE_BRIGHT),
        transparent: true,
        opacity: 0.95,
      })

      const mesh = new THREE.InstancedMesh(sphere, material, items.length)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

      const colours = new Float32Array(items.length * 3)
      const defaultCol = new THREE.Color(COLOUR_NODE_BRIGHT)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colours, 3)

      for (let i = 0; i < items.length; i++) {
        const { id, pos } = items[i]
        dummy.position.copy(pos)
        dummy.scale.setScalar(config.radius)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        mesh.setColorAt(i, defaultCol)

        instanceMap.set(id, { mesh, index: i })
      }

      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
      scene.add(mesh)
      meshes.push(mesh)
    }
  }

  const flashes = new Map()

  function update (dt, storeValues) {
    for (const [id, remaining] of flashes) {
      const next = remaining - dt
      if (next <= 0) {
        flashes.delete(id)
      } else {
        flashes.set(id, next)
      }
    }

    const dirtyMeshes = new Set()

    for (const [elementId, vqt] of storeValues) {
      const inst = instanceMap.get(elementId)
      if (!inst) continue

      const base = QUALITY_COLOURS[vqt.quality] ?? DEFAULT_COLOUR
      colour.copy(base)

      const flash = flashes.get(elementId)
      if (flash) {
        colour.lerp(WHITE, flash * 3)  // brighter flash
      }

      inst.mesh.setColorAt(inst.index, colour)
      dirtyMeshes.add(inst.mesh)
    }

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
