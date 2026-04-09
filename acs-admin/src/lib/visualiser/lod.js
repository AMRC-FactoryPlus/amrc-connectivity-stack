/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { LOD_SPARKLINE_SHOW, LOD_SPARKLINE_HIDE } from './constants.js'

function createLabelTexture (text) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const fontSize = 28
  ctx.font = `${fontSize}px Calibri, sans-serif`
  const metrics = ctx.measureText(text)
  const width = Math.ceil(metrics.width) + 12
  const height = fontSize + 12

  canvas.width = width
  canvas.height = height

  ctx.font = `${fontSize}px Calibri, sans-serif`
  ctx.fillStyle = 'rgba(100, 160, 150, 0.5)'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 6, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  return { texture, aspect: width / height }
}

export function createLOD (scene, storeNodes, positions) {
  const sparklineVisible = new Set()

  // Create all labels upfront - always visible like the old visualiser
  const labels = []
  for (const [id, entry] of storeNodes) {
    const pos = positions.get(id)
    if (!pos) continue

    // Label ISA-95 levels (sites/areas) and devices (leaves)
    // Skip if too many nodes would get labels (perf)
    const isDevice = entry.childIds.length === 0
    const isTopLevel = entry.depth <= 2
    if (!isDevice && !isTopLevel) continue

    const name = entry.node.displayName || entry.node.elementId.slice(0, 8)
    const { texture, aspect } = createLabelTexture(name)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      sizeAttenuation: true,
    })
    const sprite = new THREE.Sprite(material)
    const scale = 0.8
    sprite.scale.set(scale * aspect, scale, 1)
    sprite.position.copy(pos)
    sprite.position.y += entry.depth === 0 ? 1.5 : 0.8
    scene.add(sprite)

    labels.push({ sprite, material, texture })
  }

  console.log(`Visualiser LOD: created ${labels.length} labels`)

  // Sparkline proximity check - only needs nearby leaf nodes
  const leafPositions = new Map()
  for (const [id, entry] of storeNodes) {
    if (entry.childIds.length !== 0) continue
    const pos = positions.get(id)
    if (pos) leafPositions.set(id, pos)
  }

  function update (camera, dt, onSparklineShow, onSparklineHide) {
    const camPos = camera.position

    // Only check sparkline proximity for leaf nodes
    for (const [id, pos] of leafPositions) {
      const dist = camPos.distanceTo(pos)

      if (dist < LOD_SPARKLINE_SHOW && !sparklineVisible.has(id)) {
        sparklineVisible.add(id)
        onSparklineShow?.(id)
      } else if (dist > LOD_SPARKLINE_HIDE && sparklineVisible.has(id)) {
        sparklineVisible.delete(id)
        onSparklineHide?.(id)
      }
    }
  }

  function setOpacity (opacity) {
    for (const { material } of labels) {
      material.opacity = opacity
    }
  }

  function dispose () {
    for (const { sprite, texture, material } of labels) {
      scene.remove(sprite)
      texture.dispose()
      material.dispose()
    }
  }

  return { update, setOpacity, dispose }
}
