/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  PARTICLE_POOL_SIZE, PARTICLE_SPEED, PARTICLE_SIZE,
  COLOUR_GOOD, COLOUR_UNCERTAIN, COLOUR_BAD, COLOUR_STALE,
} from './constants.js'

const QUALITY_COLOURS = {
  Good: new THREE.Color(COLOUR_GOOD),
  GoodNoData: new THREE.Color(COLOUR_GOOD),
  Uncertain: new THREE.Color(COLOUR_UNCERTAIN),
  Bad: new THREE.Color(COLOUR_BAD),
}
const DEFAULT_COLOUR = new THREE.Color(COLOUR_STALE)

export function createParticles (scene) {
  const pool = []
  let activeCount = 0

  const geometry = new THREE.BufferGeometry()
  const posAttr = new Float32Array(PARTICLE_POOL_SIZE * 3)
  const colAttr = new Float32Array(PARTICLE_POOL_SIZE * 3)
  const sizeAttr = new Float32Array(PARTICLE_POOL_SIZE)

  geometry.setAttribute('position', new THREE.BufferAttribute(posAttr, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colAttr, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizeAttr, 1))
  geometry.setDrawRange(0, 0)

  const material = new THREE.PointsMaterial({
    size: PARTICLE_SIZE,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })

  const points = new THREE.Points(geometry, material)
  scene.add(points)

  for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
    pool.push({ path: [], pathIndex: 0, progress: 0, colour: new THREE.Color(), alive: false })
  }

  function emit (elementId, quality, storeNodes, positions, onNodeHit) {
    let p = null
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      if (!pool[i].alive) { p = pool[i]; break }
    }
    if (!p) return

    const path = []
    let current = elementId
    while (current) {
      const pos = positions.get(current)
      if (pos) path.push({ pos, id: current })
      const entry = storeNodes.get(current)
      current = entry?.parentId ?? null
    }

    if (path.length < 2) return

    p.path = path
    p.pathIndex = 0
    p.progress = 0
    p.colour.copy(QUALITY_COLOURS[quality] ?? DEFAULT_COLOUR)
    p.alive = true
    p._onNodeHit = onNodeHit
  }

  function update (dt) {
    activeCount = 0

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = pool[i]
      if (!p.alive) {
        posAttr[i * 3] = 0
        posAttr[i * 3 + 1] = -9999
        posAttr[i * 3 + 2] = 0
        sizeAttr[i] = 0
        continue
      }

      const segCount = p.path.length - 1
      const totalDuration = PARTICLE_SPEED
      const segDuration = totalDuration / segCount

      p.progress += dt
      const segIndex = Math.floor(p.progress / segDuration)

      if (segIndex >= segCount) {
        p.alive = false
        sizeAttr[i] = 0
        continue
      }

      if (segIndex > p.pathIndex) {
        const hitNode = p.path[segIndex]
        if (hitNode && p._onNodeHit) p._onNodeHit(hitNode.id)
        p.pathIndex = segIndex
      }

      const segT = (p.progress - segIndex * segDuration) / segDuration
      const from = p.path[segIndex].pos
      const to = p.path[segIndex + 1].pos

      posAttr[i * 3] = from.x + (to.x - from.x) * segT
      posAttr[i * 3 + 1] = from.y + (to.y - from.y) * segT
      posAttr[i * 3 + 2] = from.z + (to.z - from.z) * segT

      const lifeT = p.progress / totalDuration
      const fade = 1 - lifeT
      colAttr[i * 3] = p.colour.r * fade
      colAttr[i * 3 + 1] = p.colour.g * fade
      colAttr[i * 3 + 2] = p.colour.b * fade

      sizeAttr[i] = PARTICLE_SIZE * fade

      activeCount++
    }

    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
    geometry.attributes.size.needsUpdate = true
    geometry.setDrawRange(0, PARTICLE_POOL_SIZE)
  }

  function dispose () {
    scene.remove(points)
    geometry.dispose()
    material.dispose()
  }

  return { emit, update, dispose }
}
