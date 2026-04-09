/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'

const TURN = 2 * Math.PI
const JITTER = 0.3

/**
 * Compute 3D positions for all nodes in the hierarchy.
 * Uses the same radial layout approach as the old 2D visualiser:
 * angle segments proportional to leaf count, radius increases per depth.
 * Adds a 3D twist: Y offset varies with depth for visual depth.
 *
 * @param {Map} nodes - store.nodes Map (elementId -> { parentId, childIds, depth })
 * @param {string[]} rootIds - store.rootIds
 * @returns {Map<string, THREE.Vector3>} elementId -> position
 */
export function computeLayout (nodes, rootIds) {
  const positions = new Map()

  if (rootIds.length === 0) return positions

  // First pass: count leaves for each node (needed for proportional angles)
  const leafCounts = new Map()
  const maxDepthMap = new Map()

  function countLeaves (id) {
    const entry = nodes.get(id)
    if (!entry) return 1
    if (entry.childIds.length === 0) {
      leafCounts.set(id, 1)
      maxDepthMap.set(id, 0)
      return 1
    }
    let total = 0
    let maxD = 0
    for (const childId of entry.childIds) {
      total += countLeaves(childId)
      maxD = Math.max(maxD, (maxDepthMap.get(childId) ?? 0) + 1)
    }
    leafCounts.set(id, total)
    maxDepthMap.set(id, maxD)
    return total
  }

  // Count from a virtual root that contains all rootIds
  let totalLeaves = 0
  let globalMaxDepth = 0
  for (const id of rootIds) {
    totalLeaves += countLeaves(id)
    globalMaxDepth = Math.max(globalMaxDepth, (maxDepthMap.get(id) ?? 0) + 1)
  }

  // The ring spacing: how much radius increases per depth level
  // Scale so the whole tree fits nicely
  const viewRadius = 40
  const ring = globalMaxDepth > 0 ? (viewRadius * 0.8) / globalMaxDepth : viewRadius

  // Place roots at centre
  positions.set('__virtual_root__', new THREE.Vector3(0, 0, 0))

  // Place all root nodes around the centre
  const segment = TURN / Math.max(totalLeaves, 1)
  let angle = 0
  for (const id of rootIds) {
    const leaves = leafCounts.get(id) ?? 1
    placeNode(id, angle, 0, segment, ring, 0)
    angle += segment * leaves
  }

  function placeNode (id, startAngle, radius, segment, ring, depth) {
    const entry = nodes.get(id)
    if (!entry) return

    const leaves = leafCounts.get(id) ?? 1
    const myAngle = startAngle + segment * leaves / 2

    // Add jitter to radius for organic feel
    const jitter = (Math.random() - 0.5) * 0.4 * ring

    // 3D: use angle in XZ plane, with Y offset based on depth for 3D effect
    const r = radius + jitter
    const yOffset = (Math.random() - 0.5) * ring * 0.5
    const pos = new THREE.Vector3(
      r * Math.cos(myAngle),
      yOffset,
      r * Math.sin(myAngle),
    )
    positions.set(id, pos)

    // Recurse into children
    if (entry.childIds.length === 0) return

    let childAngle = startAngle
    for (const childId of entry.childIds) {
      const childLeaves = leafCounts.get(childId) ?? 1
      placeNode(childId, childAngle, radius + ring, segment, ring, depth + 1)
      childAngle += segment * childLeaves
    }
  }

  // Remove virtual root
  positions.delete('__virtual_root__')

  // Log bounds
  let maxDist = 0
  for (const pos of positions.values()) {
    const d = pos.length()
    if (d > maxDist) maxDist = d
  }
  console.log(`Visualiser layout: ${positions.size} nodes, maxDist ${maxDist.toFixed(1)}, maxDepth ${globalMaxDepth}`)

  return positions
}
