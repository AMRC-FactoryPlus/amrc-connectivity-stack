/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { COLOUR_EDGE } from './constants.js'

export function createEdges (scene) {
  let lines = null

  function build (storeNodes, positions) {
    if (lines) {
      scene.remove(lines)
      lines.geometry.dispose()
      lines.material.dispose()
    }

    const points = []

    for (const [id, entry] of storeNodes) {
      if (!entry.parentId) continue
      const from = positions.get(entry.parentId)
      const to = positions.get(id)
      if (!from || !to) continue
      points.push(from.x, from.y, from.z)
      points.push(to.x, to.y, to.z)
    }

    if (points.length === 0) return

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))

    const material = new THREE.LineBasicMaterial({
      color: COLOUR_EDGE,
      transparent: true,
      opacity: 0.4,
    })

    lines = new THREE.LineSegments(geometry, material)
    scene.add(lines)
  }

  function dispose () {
    if (lines) {
      scene.remove(lines)
      lines.geometry.dispose()
      lines.material.dispose()
    }
  }

  return { build, dispose }
}
