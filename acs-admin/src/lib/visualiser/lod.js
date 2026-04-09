/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { LOD_LABEL, LOD_SPARKLINE_SHOW, LOD_SPARKLINE_HIDE } from './constants.js'

function createLabelTexture (text) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const fontSize = 48
  ctx.font = `${fontSize}px sans-serif`
  const metrics = ctx.measureText(text)
  const width = Math.ceil(metrics.width) + 20
  const height = fontSize + 20

  canvas.width = width
  canvas.height = height

  ctx.font = `${fontSize}px sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 10, height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  return { texture, aspect: width / height }
}

export function createLOD (scene, storeNodes, positions) {
  const labels = new Map()
  const visible = new Set()
  const sparklineVisible = new Set()

  for (const [id, entry] of storeNodes) {
    const pos = positions.get(id)
    if (!pos) continue

    const name = entry.node.displayName || entry.node.elementId.slice(0, 8)
    const { texture, aspect } = createLabelTexture(name)
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(material)
    const scale = 2
    sprite.scale.set(scale * aspect, scale, 1)
    sprite.position.copy(pos)
    sprite.position.y += entry.childIds.length === 0 ? 0.5 : 2
    sprite.visible = false
    scene.add(sprite)

    labels.set(id, { sprite, material, pos: sprite.position })
  }

  function update (camera, dt, onSparklineShow, onSparklineHide) {
    const camPos = camera.position

    for (const [id, label] of labels) {
      const dist = camPos.distanceTo(label.pos)

      if (dist < LOD_LABEL) {
        if (!visible.has(id)) {
          label.sprite.visible = true
          visible.add(id)
        }
        const t = 1 - (dist / LOD_LABEL)
        label.material.opacity = Math.min(t * 2, 0.9)
      } else {
        if (visible.has(id)) {
          label.sprite.visible = false
          label.material.opacity = 0
          visible.delete(id)
        }
      }

      if (dist < LOD_SPARKLINE_SHOW && !sparklineVisible.has(id)) {
        sparklineVisible.add(id)
        onSparklineShow?.(id)
      } else if (dist > LOD_SPARKLINE_HIDE && sparklineVisible.has(id)) {
        sparklineVisible.delete(id)
        onSparklineHide?.(id)
      }
    }
  }

  function dispose () {
    for (const [, label] of labels) {
      scene.remove(label.sprite)
      label.material.map.dispose()
      label.material.dispose()
    }
  }

  return { update, dispose }
}
