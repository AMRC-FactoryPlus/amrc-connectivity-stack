/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import {
  ORBIT_SPEED, DRIFT_MIN, DRIFT_MAX, DRIFT_PERIOD,
  SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX,
  SWEEP_EASE_IN, SWEEP_HOLD, SWEEP_EASE_OUT,
  LOD_SPARKLINE_SHOW,
} from './constants.js'

function easeInOutCubic (t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function randomRange (min, max) {
  return min + Math.random() * (max - min)
}

/**
 * @param {THREE.Camera} camera
 * @param {Map} positions - elementId -> Vector3
 * @param {function} getActiveLeafIds - returns array of elementIds with live data
 */
export function createCameraController (camera, positions, getActiveLeafIds) {
  // Auto-fit: compute the bounding sphere of all positions
  let maxDist = 0
  for (const pos of positions.values()) {
    const d = pos.length()
    if (d > maxDist) maxDist = d
  }
  // Camera orbits outside the bounding sphere - viewing the whole graph
  const baseDistance = Math.max(maxDist * 1.8, 25)
  const elevationBase = baseDistance * 0.15   // slight elevation for perspective
  const elevationSwing = baseDistance * 0.05  // subtle vertical bob

  console.log(`Visualiser camera: baseDistance ${baseDistance.toFixed(1)} (maxNodeDist ${maxDist.toFixed(1)})`)

  let angle = 0
  let elapsed = 0
  let nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)

  // Sweep state
  let sweeping = false
  let sweepStartPos = new THREE.Vector3()
  let sweepStartLook = new THREE.Vector3()
  let sweepEndPos = new THREE.Vector3()
  let sweepEndLook = new THREE.Vector3()
  let sweepTime = 0
  let sweepPhase = 'idle'
  let sweepPhaseDuration = 0

  const lookTarget = new THREE.Vector3(0, 0, 0)

  function pickSweepTarget () {
    // Only sweep to leaf nodes that have live data
    const activeIds = getActiveLeafIds ? getActiveLeafIds() : []
    const candidates = []
    for (const id of activeIds) {
      const pos = positions.get(id)
      if (pos) candidates.push({ id, pos })
    }
    // Fallback: if no active leaves, don't sweep
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  function startSweep () {
    const target = pickSweepTarget()
    if (!target) return

    sweeping = true
    sweepPhase = 'ease-in'
    sweepPhaseDuration = SWEEP_EASE_IN
    sweepTime = 0

    sweepStartPos.copy(camera.position)
    sweepStartLook.copy(lookTarget)

    const offset = new THREE.Vector3(
      LOD_SPARKLINE_SHOW * 0.8,
      LOD_SPARKLINE_SHOW * 0.3,
      LOD_SPARKLINE_SHOW * 0.5,
    )
    sweepEndPos.copy(target.pos).add(offset)
    sweepEndLook.copy(target.pos)
  }

  function endSweep () {
    sweepPhase = 'ease-out'
    sweepPhaseDuration = SWEEP_EASE_OUT
    sweepTime = 0

    sweepStartPos.copy(camera.position)
    sweepStartLook.copy(lookTarget)

    const drift = DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * 0.5
    const dist = baseDistance * drift
    sweepEndPos.set(
      Math.cos(angle) * dist,
      elevationBase,
      Math.sin(angle) * dist,
    )
    sweepEndLook.set(0, 0, 0)
  }

  function update (dt) {
    elapsed += dt

    if (sweeping) {
      sweepTime += dt
      const t = Math.min(sweepTime / sweepPhaseDuration, 1)
      const eased = easeInOutCubic(t)

      camera.position.lerpVectors(sweepStartPos, sweepEndPos, eased)
      lookTarget.lerpVectors(sweepStartLook, sweepEndLook, eased)
      camera.lookAt(lookTarget)

      if (t >= 1) {
        if (sweepPhase === 'ease-in') {
          sweepPhase = 'hold'
          sweepPhaseDuration = SWEEP_HOLD
          sweepTime = 0
        } else if (sweepPhase === 'hold') {
          endSweep()
        } else if (sweepPhase === 'ease-out') {
          sweeping = false
          nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)
        }
      }

      return
    }

    // Normal orbit
    angle += ORBIT_SPEED * dt

    const driftT = (Math.sin(elapsed * (2 * Math.PI / DRIFT_PERIOD)) + 1) / 2
    const drift = DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * driftT
    const dist = baseDistance * drift

    camera.position.set(
      Math.cos(angle) * dist,
      elevationBase + elevationSwing * Math.sin(elapsed * 0.1),
      Math.sin(angle) * dist,
    )

    lookTarget.set(0, 0, 0)
    camera.lookAt(lookTarget)

    nextSweep -= dt
    if (nextSweep <= 0) {
      startSweep()
      // If no target found, retry in 5s instead of waiting another 30-45s
      if (!sweeping) nextSweep = 5
    }
  }

  function getLookTarget () {
    return lookTarget
  }

  return { update, getLookTarget }
}
