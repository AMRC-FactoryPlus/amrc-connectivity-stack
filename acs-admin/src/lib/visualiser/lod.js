/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { LOD_SPARKLINE_SHOW, LOD_SPARKLINE_HIDE } from './constants.js'

function createLabelTexture (text) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const fontSize = 24
  ctx.font = `${fontSize}px Calibri, sans-serif`
  const metrics = ctx.measureText(text)
  const width = Math.ceil(metrics.width) + 8
  const height = fontSize + 8

  canvas.width = width
  canvas.height = height

  ctx.font = `${fontSize}px Calibri, sans-serif`
  ctx.fillStyle = 'rgba(140, 210, 200, 0.9)'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 6, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  return { texture, aspect: width / height }
}

const _screenPos = new THREE.Vector3()

export function createLOD (scene, storeNodes, positions, { labelAll = false } = {}) {
  const sparklineVisible = new Set()

  // Create all labels, sorted by priority (lower depth = higher priority)
  const labels = []
  for (const [id, entry] of storeNodes) {
    const pos = positions.get(id)
    if (!pos) continue

    if (!labelAll) {
      const isDevice = entry.childIds.length === 0
      const isTopLevel = entry.depth <= 2
      if (!isDevice && !isTopLevel) continue
    }

    const name = entry.node.displayName || entry.node.elementId.slice(0, 8)
    const { texture, aspect } = createLabelTexture(name)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: false,
    })
    const sprite = new THREE.Sprite(material)
    const depth = entry.depth ?? 0
    // Larger labels for higher hierarchy: depth 0 = 0.024, depth 1 = 0.020, etc. min 0.012
    const scale = Math.max(0.012, 0.024 - depth * 0.004)
    sprite.scale.set(scale * aspect, scale, 1)
    sprite.position.copy(pos)
    sprite.position.y += 0.3
    scene.add(sprite)

    labels.push({
      sprite, material, texture,
      nodePos: pos.clone(),
      depth: entry.depth ?? 0,
      screenWidth: scale * aspect,
      screenHeight: scale,
    })
  }

  // Sort by depth (priority) - lower depth first
  labels.sort((a, b) => a.depth - b.depth)

  console.log(`Visualiser LOD: created ${labels.length} labels`)

  // Sparkline proximity check
  const leafPositions = new Map()
  for (const [id, entry] of storeNodes) {
    if (entry.childIds.length !== 0) continue
    const pos = positions.get(id)
    if (pos) leafPositions.set(id, pos)
  }

  // Reusable array for screen positions
  let _globalOpacity = 1

  function update (camera, dt, onSparklineShow, onSparklineHide) {
    const camPos = camera.position

    if (_globalOpacity < 0.05) return  // all hidden, skip

    // Project all labels to screen space and do overlap culling
    const occupied = []  // [{sx, sy, hw, hh}] - screen rects of visible labels

    for (const label of labels) {
      // Reposition: fixed screen offset above node
      const dist = camPos.distanceTo(label.nodePos)
      const offset = dist * 0.02
      label.sprite.position.copy(label.nodePos)
      label.sprite.position.y += offset

      // Project to screen space
      _screenPos.copy(label.sprite.position)
      _screenPos.project(camera)

      // Behind camera? hide
      if (_screenPos.z > 1) {
        label.sprite.visible = false
        continue
      }

      const sx = _screenPos.x
      const sy = _screenPos.y
      // Approximate screen half-extents for the label
      const hw = label.screenWidth * 0.5
      const hh = label.screenHeight * 0.5

      // Check overlap against already-placed (higher priority) labels
      let overlaps = false
      for (const rect of occupied) {
        if (Math.abs(sx - rect.sx) < (hw + rect.hw) &&
            Math.abs(sy - rect.sy) < (hh + rect.hh)) {
          overlaps = true
          break
        }
      }

      if (overlaps) {
        label.sprite.visible = false
      } else {
        label.sprite.visible = true
        label.material.opacity = _globalOpacity
        occupied.push({ sx, sy, hw, hh })
      }
    }

    // Sparkline proximity
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
    _globalOpacity = opacity
    if (opacity < 0.05) {
      for (const { sprite } of labels) sprite.visible = false
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
