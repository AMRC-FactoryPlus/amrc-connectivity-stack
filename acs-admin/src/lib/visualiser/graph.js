/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'

// Golden angle in radians for even sphere distribution
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

// Distance between hierarchy shells
const SHELL_SPACING = 20

// Jitter to avoid perfect overlaps
const JITTER = 0.5

/**
 * Compute 3D positions for all nodes in the hierarchy.
 *
 * @param {Map} nodes - store.nodes Map (elementId -> { parentId, childIds, depth })
 * @param {string[]} rootIds - store.rootIds
 * @returns {Map<string, THREE.Vector3>} elementId -> position
 */
export function computeLayout (nodes, rootIds) {
  const positions = new Map()

  if (rootIds.length === 0) return positions

  // Place roots at the centre, spread slightly
  placeGroup(rootIds, new THREE.Vector3(0, 0, 0), 5, positions)

  // BFS outward, placing children around their parent
  const queue = [...rootIds]

  while (queue.length > 0) {
    const parentId = queue.shift()
    const parent = nodes.get(parentId)
    if (!parent || parent.childIds.length === 0) continue

    const parentPos = positions.get(parentId)
    const radius = SHELL_SPACING * (1 - 0.15 * Math.min(parent.depth, 4))

    placeGroup(parent.childIds, parentPos, radius, positions)

    for (const childId of parent.childIds) {
      queue.push(childId)
    }
  }

  return positions
}

/**
 * Distribute a group of node IDs on a sphere around a centre point.
 */
function placeGroup (ids, centre, radius, positions) {
  const count = ids.length

  for (let i = 0; i < count; i++) {
    const id = ids[i]
    if (positions.has(id)) continue

    if (count === 1) {
      // Single child: offset slightly from parent
      positions.set(id, new THREE.Vector3(
        centre.x + radius * 0.5,
        centre.y,
        centre.z,
      ))
      continue
    }

    // Fibonacci sphere distribution
    const y = 1 - (2 * i / (count - 1))  // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = GOLDEN_ANGLE * i

    const x = radiusAtY * Math.cos(theta)
    const z = radiusAtY * Math.sin(theta)

    // Add small jitter to avoid exact overlaps
    const jx = (Math.random() - 0.5) * JITTER
    const jy = (Math.random() - 0.5) * JITTER
    const jz = (Math.random() - 0.5) * JITTER

    positions.set(id, new THREE.Vector3(
      centre.x + x * radius + jx,
      centre.y + y * radius + jy,
      centre.z + z * radius + jz,
    ))
  }
}
