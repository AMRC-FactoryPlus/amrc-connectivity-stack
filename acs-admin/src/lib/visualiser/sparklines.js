/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  SPARKLINE_WIDTH, SPARKLINE_HEIGHT, SPARKLINE_HISTORY_SECS,
} from './constants.js'

const QUALITY_CSS = {
  Good: '#009FE3',
  GoodNoData: '#009FE3',
  Uncertain: '#F5A623',
  Bad: '#F24B5B',
}

function drawSparkline (canvas, ctx, points, quality) {
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  if (points.length < 2) return

  ctx.fillStyle = 'rgba(10, 10, 26, 0.7)'
  ctx.fillRect(0, 0, w, h)

  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    if (p.value < min) min = p.value
    if (p.value > max) max = p.value
  }
  const range = max - min || 1

  const now = Date.now()
  const timeStart = now - SPARKLINE_HISTORY_SECS * 1000

  const colour = QUALITY_CSS[quality] ?? '#888888'

  ctx.strokeStyle = colour
  ctx.lineWidth = 2
  ctx.beginPath()

  let started = false
  for (const p of points) {
    const t = new Date(p.timestamp).getTime()
    const x = ((t - timeStart) / (SPARKLINE_HISTORY_SECS * 1000)) * w
    const y = h - ((p.value - min) / range) * (h * 0.8) - h * 0.1

    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()

  ctx.lineTo(w, h)
  ctx.lineTo(0, h)
  ctx.closePath()
  ctx.fillStyle = colour.replace(')', ', 0.15)').replace('rgb', 'rgba')
  ctx.fill()
}

export function createSparklines (scene) {
  const active = new Map()

  function show (elementId, position) {
    if (active.has(elementId)) return

    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const geometry = new THREE.PlaneGeometry(SPARKLINE_WIDTH, SPARKLINE_HEIGHT)
    const plane = new THREE.Mesh(geometry, material)
    plane.position.copy(position)
    plane.position.x += SPARKLINE_WIDTH * 0.6
    plane.position.y += SPARKLINE_HEIGHT * 0.3
    scene.add(plane)

    active.set(elementId, { plane, canvas, ctx, texture, material, geometry })
  }

  function hide (elementId) {
    const entry = active.get(elementId)
    if (!entry) return
    scene.remove(entry.plane)
    entry.texture.dispose()
    entry.material.dispose()
    entry.geometry.dispose()
    active.delete(elementId)
  }

  function update (camera, storeHistory, storeValues) {
    for (const [id, entry] of active) {
      const hist = storeHistory.get(id)
      const vqt = storeValues.get(id)
      const quality = vqt?.quality ?? 'Good'

      if (hist && hist.points.length > 0) {
        drawSparkline(entry.canvas, entry.ctx, hist.points, quality)
        entry.texture.needsUpdate = true
      }

      entry.plane.lookAt(camera.position)
    }
  }

  function dispose () {
    for (const [id] of active) hide(id)
  }

  return { show, hide, update, dispose }
}
