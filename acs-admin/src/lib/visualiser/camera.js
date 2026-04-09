/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
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

const IDLE_TIMEOUT = 10

/**
 * @param {THREE.Camera} camera
 * @param {HTMLElement} domElement
 * @param {Map} positions - elementId -> Vector3
 * @param {function} getActiveLeafIds - returns array of elementIds with live data
 * @param {object} callbacks - { onSweepIn(id), onSweepOut(id) }
 */
export function createCameraController (camera, domElement, positions, getActiveLeafIds, callbacks = {}) {
  const controls = new OrbitControls(camera, domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.enablePan = true
  controls.enableZoom = true
  controls.target.set(0, 0, 0)

  let maxDist = 0
  for (const pos of positions.values()) {
    const d = pos.length()
    if (d > maxDist) maxDist = d
  }
  const baseDistance = Math.max(maxDist * 1.8, 25)
  const elevationBase = baseDistance * 0.15
  const elevationSwing = baseDistance * 0.05

  console.log(`Visualiser camera: baseDistance ${baseDistance.toFixed(1)} (maxNodeDist ${maxDist.toFixed(1)})`)

  let angle = 0
  let elapsed = 0
  let nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)

  // User interaction
  let userInteracting = false
  let idleTimer = 0

  controls.addEventListener('start', () => {
    userInteracting = true
    idleTimer = 0
    if (sweeping && sweepPhase !== 'ease-out') {
      // User grabbed during a sweep - cancel it
      if (sweepTargetId && callbacks.onSweepOut) callbacks.onSweepOut(sweepTargetId)
      sweeping = false
      sweepPhase = 'idle'
    }
  })
  controls.addEventListener('end', () => {
    idleTimer = 0
  })

  // Sweep state
  let sweeping = false
  let sweepStartPos = new THREE.Vector3()
  let sweepStartLook = new THREE.Vector3()
  let sweepEndPos = new THREE.Vector3()
  let sweepEndLook = new THREE.Vector3()
  let sweepTime = 0
  let sweepPhase = 'idle'
  let sweepPhaseDuration = 0
  let sweepTargetId = null
  let sweepTargetPos = null

  const lookTarget = new THREE.Vector3(0, 0, 0)

  function pickSweepTarget () {
    const activeIds = getActiveLeafIds ? getActiveLeafIds() : []
    const candidates = []
    for (const id of activeIds) {
      const pos = positions.get(id)
      if (pos) candidates.push({ id, pos })
    }
    if (candidates.length === 0) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  function getOrbitPos () {
    const driftT = (Math.sin(elapsed * (2 * Math.PI / DRIFT_PERIOD)) + 1) / 2
    const drift = DRIFT_MIN + (DRIFT_MAX - DRIFT_MIN) * driftT
    const dist = baseDistance * drift
    return new THREE.Vector3(
      Math.cos(angle) * dist,
      elevationBase + elevationSwing * Math.sin(elapsed * 0.1),
      Math.sin(angle) * dist,
    )
  }

  function startSweep () {
    const target = pickSweepTarget()
    if (!target) return

    sweepTargetId = target.id
    sweepTargetPos = target.pos.clone()
    sweeping = true
    sweepPhase = 'ease-in'
    sweepPhaseDuration = SWEEP_EASE_IN
    sweepTime = 0

    sweepStartPos.copy(camera.position)
    sweepStartLook.copy(controls.target)

    const offset = new THREE.Vector3(
      LOD_SPARKLINE_SHOW * 0.8,
      LOD_SPARKLINE_SHOW * 0.3,
      LOD_SPARKLINE_SHOW * 0.5,
    )
    sweepEndPos.copy(target.pos).add(offset)
    sweepEndLook.copy(target.pos)

    if (callbacks.onSweepIn) callbacks.onSweepIn(target.id)
  }

  function startEaseOut () {
    sweepPhase = 'ease-out'
    sweepPhaseDuration = SWEEP_EASE_OUT
    sweepTime = 0

    sweepStartPos.copy(camera.position)
    sweepStartLook.copy(controls.target)

    // Sync angle to current time so the orbit position is smooth
    angle = ORBIT_SPEED * elapsed
    sweepEndPos.copy(getOrbitPos())
    sweepEndLook.set(0, 0, 0)

    if (sweepTargetId && callbacks.onSweepOut) callbacks.onSweepOut(sweepTargetId)
  }

  function update (dt) {
    elapsed += dt

    // User interaction mode
    if (userInteracting) {
      idleTimer += dt
      if (idleTimer > IDLE_TIMEOUT) {
        userInteracting = false
        angle = Math.atan2(camera.position.z, camera.position.x)
        nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)
      }
      controls.update()
      return
    }

    if (sweeping) {
      sweepTime += dt
      const t = Math.min(sweepTime / sweepPhaseDuration, 1)
      const eased = easeInOutCubic(t)

      if (sweepPhase === 'hold') {
        // Stay put during hold - don't lerp, just keep position stable
        // Slowly orbit around the target
        const holdAngle = sweepTime * 0.1
        const holdDist = LOD_SPARKLINE_SHOW * 0.9
        camera.position.set(
          sweepTargetPos.x + Math.cos(holdAngle) * holdDist,
          sweepTargetPos.y + holdDist * 0.3,
          sweepTargetPos.z + Math.sin(holdAngle) * holdDist,
        )
        controls.target.copy(sweepTargetPos)
        controls.update()
      } else {
        camera.position.lerpVectors(sweepStartPos, sweepEndPos, eased)
        lookTarget.lerpVectors(sweepStartLook, sweepEndLook, eased)
        controls.target.copy(lookTarget)
        controls.update()
      }

      if (t >= 1) {
        if (sweepPhase === 'ease-in') {
          sweepPhase = 'hold'
          sweepPhaseDuration = SWEEP_HOLD
          sweepTime = 0
        } else if (sweepPhase === 'hold') {
          startEaseOut()
        } else if (sweepPhase === 'ease-out') {
          sweeping = false
          sweepTargetId = null
          sweepTargetPos = null
          nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)
        }
      }

      return
    }

    // Normal auto-orbit
    angle += ORBIT_SPEED * dt
    const orbitPos = getOrbitPos()
    camera.position.copy(orbitPos)
    controls.target.set(0, 0, 0)
    controls.update()

    nextSweep -= dt
    if (nextSweep <= 0) {
      startSweep()
      if (!sweeping) nextSweep = 5
    }
  }

  function getLookTarget () {
    return controls.target
  }

  function getSweepState () {
    if (!sweeping) return null
    return {
      phase: sweepPhase,
      targetId: sweepTargetId,
    }
  }

  function dispose () {
    controls.dispose()
  }

  return { update, getLookTarget, getSweepState, dispose }
}
