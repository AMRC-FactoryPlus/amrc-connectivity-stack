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
const TOUR_STOP_HOLD = 5     // seconds at each leaf stop
const TOUR_STOP_TRAVEL = 2   // seconds travelling between stops
const MAX_TOUR_STOPS = 10

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

  let userInteracting = false
  let idleTimer = 0

  controls.addEventListener('start', () => {
    userInteracting = true
    idleTimer = 0
    if (sweeping && sweepPhase !== 'ease-out') {
      if (sweepTargetId && callbacks.onSweepOut) callbacks.onSweepOut(sweepTargetId)
      sweeping = false
      sweepPhase = 'idle'
    }
  })
  controls.addEventListener('end', () => { idleTimer = 0 })

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

  // Mini-tour state
  let tourStops = []      // [{id, pos}, ...] - leaf nodes to visit
  let tourIndex = 0
  let tourSubPhase = 'travel' // 'travel' | 'hold'
  let tourSubTime = 0
  let tourFromPos = new THREE.Vector3()
  let tourFromLook = new THREE.Vector3()
  let tourToPos = new THREE.Vector3()
  let tourToLook = new THREE.Vector3()

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

  function getCameraOffsetForTarget (targetPos) {
    // Position camera near the target, offset so we can see it
    return new THREE.Vector3(
      targetPos.x + LOD_SPARKLINE_SHOW * 0.7,
      targetPos.y + LOD_SPARKLINE_SHOW * 0.3,
      targetPos.z + LOD_SPARKLINE_SHOW * 0.5,
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
    sweepEndPos.copy(getCameraOffsetForTarget(target.pos))
    sweepEndLook.copy(target.pos)

    // Reset tour
    tourStops = []
    tourIndex = 0

    if (callbacks.onSweepIn) callbacks.onSweepIn(target.id)
  }

  /**
   * Called by Visualiser after device expansion to set the leaf stops.
   * @param {Array<{id: string, pos: THREE.Vector3}>} stops
   */
  function setTourStops (stops) {
    tourStops = stops.slice(0, MAX_TOUR_STOPS)
    tourIndex = 0
    if (tourStops.length > 0) {
      startTourTravel()
    }
  }

  function startTourTravel () {
    const stop = tourStops[tourIndex]
    if (!stop) return

    tourSubPhase = 'travel'
    tourSubTime = 0
    tourFromPos.copy(camera.position)
    tourFromLook.copy(controls.target)
    tourToPos.copy(getCameraOffsetForTarget(stop.pos))
    tourToLook.copy(stop.pos)

    if (callbacks.onTourStop) callbacks.onTourStop(stop.id)
  }

  function startEaseOut () {
    sweepPhase = 'ease-out'
    sweepPhaseDuration = SWEEP_EASE_OUT
    sweepTime = 0

    sweepStartPos.copy(camera.position)
    sweepStartLook.copy(controls.target)

    angle = ORBIT_SPEED * elapsed
    sweepEndPos.copy(getOrbitPos())
    sweepEndLook.set(0, 0, 0)

    if (sweepTargetId && callbacks.onSweepOut) callbacks.onSweepOut(sweepTargetId)
  }

  function update (dt) {
    elapsed += dt

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

      if (sweepPhase === 'tour') {
        // Mini-tour: travel between leaf stops
        tourSubTime += dt

        if (tourSubPhase === 'travel') {
          const t = Math.min(tourSubTime / TOUR_STOP_TRAVEL, 1)
          const eased = easeInOutCubic(t)
          camera.position.lerpVectors(tourFromPos, tourToPos, eased)
          lookTarget.lerpVectors(tourFromLook, tourToLook, eased)
          controls.target.copy(lookTarget)
          controls.update()

          if (t >= 1) {
            tourSubPhase = 'hold'
            tourSubTime = 0
          }
        } else if (tourSubPhase === 'hold') {
          // Slowly orbit around current stop
          const stop = tourStops[tourIndex]
          if (stop) {
            const holdAngle = tourSubTime * 0.15
            const holdDist = LOD_SPARKLINE_SHOW * 0.6
            camera.position.set(
              stop.pos.x + Math.cos(holdAngle) * holdDist,
              stop.pos.y + holdDist * 0.25,
              stop.pos.z + Math.sin(holdAngle) * holdDist,
            )
            controls.target.copy(stop.pos)
            controls.update()
          }

          if (tourSubTime >= TOUR_STOP_HOLD) {
            // Move to next stop or exit
            tourIndex++
            if (tourIndex < tourStops.length) {
              startTourTravel()
            } else {
              startEaseOut()
            }
          }
        }
        return
      }

      // ease-in and ease-out
      const t = Math.min(sweepTime / sweepPhaseDuration, 1)
      const eased = easeInOutCubic(t)

      camera.position.lerpVectors(sweepStartPos, sweepEndPos, eased)
      lookTarget.lerpVectors(sweepStartLook, sweepEndLook, eased)
      controls.target.copy(lookTarget)
      controls.update()

      if (t >= 1) {
        if (sweepPhase === 'ease-in') {
          sweepPhase = 'tour'
          sweepTime = 0
          // If no tour stops yet (still loading), wait at device
          if (tourStops.length === 0) {
            // Will start touring when setTourStops is called
          } else {
            startTourTravel()
          }
        } else if (sweepPhase === 'ease-out') {
          sweeping = false
          sweepTargetId = null
          sweepTargetPos = null
          tourStops = []
          nextSweep = randomRange(SWEEP_INTERVAL_MIN, SWEEP_INTERVAL_MAX)
        }
      }

      return
    }

    // Normal auto-orbit
    angle += ORBIT_SPEED * dt
    camera.position.copy(getOrbitPos())
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
      tourStopId: (sweepPhase === 'tour' && tourStops[tourIndex]) ? tourStops[tourIndex].id : null,
    }
  }

  function dispose () {
    controls.dispose()
  }

  return { update, getLookTarget, getSweepState, setTourStops, dispose }
}
