/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { BG_COLOUR } from './constants.js'

export function createScene (canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(canvas.clientWidth, canvas.clientHeight)
  renderer.setClearColor(BG_COLOUR)

  const scene = new THREE.Scene()
  // No fog - let all nodes be visible regardless of distance

  const camera = new THREE.PerspectiveCamera(
    60,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    2000,
  )
  camera.position.set(0, 10, 30)
  camera.lookAt(0, 0, 0)

  // Ambient light - brighter so nodes read well against dark bg
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))

  // Subtle point light at centre
  const centreLight = new THREE.PointLight(0x009fe3, 0.5, 300)
  centreLight.position.set(0, 0, 0)
  scene.add(centreLight)

  // Post-processing: subtle bloom - high threshold so only bright
  // emissive nodes glow, not labels or edges
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
    0.6,   // strength (was 1.2 - much more subtle now)
    0.3,   // radius
    0.9,   // threshold (higher = only bright things bloom)
  )
  composer.addPass(bloom)

  // Resize handler
  function onResize () {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    composer.setSize(w, h)
  }

  // Render loop
  let frameId = null
  let lastTime = performance.now()
  const callbacks = []

  function animate (time) {
    frameId = requestAnimationFrame(animate)
    const dt = (time - lastTime) / 1000
    lastTime = time
    for (const cb of callbacks) cb(dt, time / 1000)
    composer.render()
  }

  function start () {
    window.addEventListener('resize', onResize)
    onResize()
    frameId = requestAnimationFrame(animate)
  }

  function dispose () {
    if (frameId != null) cancelAnimationFrame(frameId)
    window.removeEventListener('resize', onResize)
    renderer.dispose()
    composer.dispose()
  }

  function onUpdate (cb) {
    callbacks.push(cb)
  }

  return { scene, camera, renderer, composer, start, dispose, onUpdate }
}
