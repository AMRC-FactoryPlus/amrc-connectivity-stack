/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  PARTICLE_POOL_SIZE, PARTICLE_SPEED, PARTICLE_SIZE,
} from './constants.js'

// Pink packet colour matching old visualiser: rgb(244,215,241)
const PACKET_PINK = 0xf4d7f1

// Use a small pool of actual Mesh objects - guaranteed visible
const POOL_SIZE = Math.min(PARTICLE_POOL_SIZE, 50)  // cap for perf with real meshes

export function createParticles (scene) {
  const sphereGeo = new THREE.SphereGeometry(PARTICLE_SIZE, 8, 6)
  const pool = []

  for (let i = 0; i < POOL_SIZE; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: PACKET_PINK, transparent: true, opacity: 0.9 })
    const mesh = new THREE.Mesh(sphereGeo, mat)
    mesh.visible = false
    scene.add(mesh)
    pool.push({
      mesh,
      path: [],
      pathIndex: 0,
      progress: 0,
      alive: false,
      _onNodeHit: null,
    })
  }

  let _logCount = 0

  function emit (elementId, quality, storeNodes, positions, onNodeHit) {
    // Find a dead particle
    let p = null
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!pool[i].alive) { p = pool[i]; break }
    }
    if (!p) return

    // Build path from leaf to root
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
    p.alive = true
    p.mesh.visible = true
    p._onNodeHit = onNodeHit

    if (_logCount < 3) {
      console.log(`Particles: emit path=${path.length} hops`)
      _logCount++
    }
  }

  function update (dt) {
    const clampedDt = Math.min(dt, 0.1)

    for (let i = 0; i < POOL_SIZE; i++) {
      const p = pool[i]
      if (!p.alive) continue

      const segCount = p.path.length - 1
      const totalDuration = PARTICLE_SPEED
      const segDuration = totalDuration / segCount

      p.progress += clampedDt
      const segIndex = Math.floor(p.progress / segDuration)

      if (segIndex >= segCount) {
        p.alive = false
        p.mesh.visible = false
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

      p.mesh.position.set(
        from.x + (to.x - from.x) * segT,
        from.y + (to.y - from.y) * segT,
        from.z + (to.z - from.z) * segT,
      )
    }
  }

  function dispose () {
    for (const p of pool) {
      scene.remove(p.mesh)
      p.mesh.material.dispose()
    }
    sphereGeo.dispose()
  }

  return { emit, update, dispose }
}
