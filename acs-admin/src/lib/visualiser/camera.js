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

export function createCameraController (camera, positions) {
  const baseDistance = 100
  let angle = 0
  let elapsed = 0
  let nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)

  // Sweep state
  let sweeping = false
  let sweepTarget = null
  let sweepStartPos = new THREE.Vector3()
  let sweepStartLook = new THREE.Vector3()
  let sweepEndPos = new THREE.Vector3()
  let sweepEndLook = new THREE.Vector3()
  let sweepTime = 0
  let sweepPhase = 'idle'  // idle | ease-in | hold | ease-out
  let sweepPhaseDuration = 0

  // Current look target (for smooth interpolation)
  const lookTarget = new THREE.Vector3(0, 0, 0)

  function pickSweepTarget () {
    // Pick a random node that has children (a device cluster)
    const candidates = []
    for (const [id, pos] of positions) {
      candidates.push({ id, pos })
    }
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  function startSweep () {
    const target = pickSweepTarget()
    if (!target) return

    sweepTarget = target
    sweeping = true
    sweepPhase = 'ease-in'
    sweepPhaseDuration = SWEEP_EASE_IN
    sweepTime = 0

    sweepStartPos.copy(camera.position)
    sweepStartLook.copy(lookTarget)

    // Position camera close to the target, offset slightly
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

    // Return to orbit position
    const drift = DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * 0.5
    const dist = baseDistance * drift
    sweepEndPos.set(
      Math.cos(angle) * dist,
      40,
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
      30 + 10 * Math.sin(elapsed * 0.1),
      Math.sin(angle) * dist,
    )

    lookTarget.set(0, 0, 0)
    camera.lookAt(lookTarget)

    // Check if it's time for a sweep
    nextSweep -= dt
    if (nextSweep <= 0) {
      startSweep()
    }
  }

  /** Returns the position the camera is currently looking at. */
  function getLookTarget () {
    return lookTarget
  }

  return { update, getLookTarget }
}
