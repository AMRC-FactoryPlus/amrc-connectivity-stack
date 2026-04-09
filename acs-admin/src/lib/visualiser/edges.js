/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { COLOUR_EDGE } from './constants.js'

export function createEdges (scene) {
  let line = null
  let material = null

  function build (storeNodes, positions) {
    if (line) {
      scene.remove(line)
      line.geometry.dispose()
    }
    if (material) material.dispose()

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

    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(points)

    material = new LineMaterial({
      color: COLOUR_EDGE,
      linewidth: 2,
      transparent: true,
      opacity: 0.5,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    })

    line = new LineSegments2(geometry, material)
    scene.add(line)

    window.addEventListener('resize', () => {
      if (material) {
        material.resolution.set(window.innerWidth, window.innerHeight)
      }
    })
  }

  function dispose () {
    if (line) {
      scene.remove(line)
      line.geometry.dispose()
    }
    if (material) material.dispose()
  }

  return { build, dispose }
}
