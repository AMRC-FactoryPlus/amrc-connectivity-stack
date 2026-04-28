/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Compute 3D positions for all nodes in the hierarchy.
 * Concentric shells: root at centre, each depth level on a larger sphere.
 * Within each shell, nodes are placed near their parent's angular direction
 * but pushed outward to the shell radius.
 */
export function computeLayout (nodes, rootIds) {
  const positions = new Map()
  if (rootIds.length === 0) return positions

  // Find max depth
  let globalMaxDepth = 0
  function findMaxDepth (id, depth) {
    const entry = nodes.get(id)
    if (!entry) return
    if (depth > globalMaxDepth) globalMaxDepth = depth
    for (const childId of entry.childIds) {
      findMaxDepth(childId, depth + 1)
    }
  }
  for (const id of rootIds) findMaxDepth(id, 0)

  // Shell radius per depth level
  const shellSpacing = 12
  function shellRadius (depth) {
    return depth * shellSpacing
  }

  // Place roots at centre
  if (rootIds.length === 1) {
    positions.set(rootIds[0], new THREE.Vector3(0, 0, 0))
  } else {
    // Multiple roots: small ring at centre
    for (let i = 0; i < rootIds.length; i++) {
      const a = (2 * Math.PI * i) / rootIds.length
      positions.set(rootIds[i], new THREE.Vector3(Math.cos(a) * 2, 0, Math.sin(a) * 2))
    }
  }

  // BFS level by level. For each child, compute an angular direction
  // from the centre (not from the parent), then place at the shell radius.
  // Children spread around their parent's direction.
  const queue = [...rootIds]

  while (queue.length > 0) {
    const parentId = queue.shift()
    const entry = nodes.get(parentId)
    if (!entry || entry.childIds.length === 0) continue

    const parentPos = positions.get(parentId)
    if (!parentPos) continue

    const children = entry.childIds
    const count = children.length
    const childDepth = (entry.depth ?? 0) + 1
    const childShell = shellRadius(childDepth)

    // Parent's angular direction from centre (spherical coords)
    const parentDist = parentPos.length()
    let parentTheta, parentPhi
    if (parentDist < 0.01) {
      // Parent is at centre - spread children evenly on the shell
      parentTheta = 0
      parentPhi = 0
    } else {
      parentTheta = Math.atan2(parentPos.z, parentPos.x)
      parentPhi = Math.asin(Math.max(-1, Math.min(1, parentPos.y / parentDist)))
    }

    // Spread angle: how much angular space children get
    // Fewer children = tighter cluster, more = wider spread
    const spreadAngle = Math.min(Math.PI * 0.4, 0.15 + count * 0.05)

    for (let i = 0; i < count; i++) {
      const childId = children[i]
      if (positions.has(childId)) continue

      let theta, phi

      if (parentDist < 0.01) {
        // Parent at centre: use Fibonacci sphere for even distribution
        const y = count === 1 ? 0 : 1 - (2 * i) / (count - 1)
        const rAtY = Math.sqrt(1 - y * y)
        const t = GOLDEN_ANGLE * i
        theta = t
        phi = Math.asin(y)
      } else {
        // Offset from parent's direction within the spread cone
        if (count === 1) {
          theta = parentTheta + (Math.random() - 0.5) * 0.1
          phi = parentPhi + (Math.random() - 0.5) * 0.1
        } else {
          // Distribute in a disc around parent's direction
          // Use golden angle for even distribution within the cone
          const t = GOLDEN_ANGLE * i
          const r = spreadAngle * Math.sqrt((i + 0.5) / count)  // sunflower pattern

          theta = parentTheta + r * Math.cos(t)
          phi = parentPhi + r * Math.sin(t)
        }
      }

      // Clamp phi to avoid poles
      phi = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, phi))

      // Add small jitter
      theta += (Math.random() - 0.5) * 0.05
      phi += (Math.random() - 0.5) * 0.05

      // Spherical to cartesian at the shell radius
      const x = childShell * Math.cos(phi) * Math.cos(theta)
      const y = childShell * Math.sin(phi)
      const z = childShell * Math.cos(phi) * Math.sin(theta)

      positions.set(childId, new THREE.Vector3(x, y, z))
      queue.push(childId)
    }
  }

  let maxDist = 0
  for (const pos of positions.values()) {
    const d = pos.length()
    if (d > maxDist) maxDist = d
  }
  console.log(`Visualiser layout: ${positions.size} nodes, maxDist ${maxDist.toFixed(1)}, maxDepth ${globalMaxDepth}, shells ${globalMaxDepth} x ${shellSpacing}`)

  return positions
}
