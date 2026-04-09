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
  scene.fog = new THREE.FogExp2(BG_COLOUR, 0.003)

  const camera = new THREE.PerspectiveCamera(
    60,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    2000,
  )
  camera.position.set(0, 40, 100)
  camera.lookAt(0, 0, 0)

  // Ambient light so nodes are visible from all angles
  scene.add(new THREE.AmbientLight(0xffffff, 0.4))

  // Point light at centre for glow effect
  const centreLight = new THREE.PointLight(0x009fe3, 1, 200)
  centreLight.position.set(0, 0, 0)
  scene.add(centreLight)

  // Post-processing: bloom for the cosmos glow
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
    1.2,   // strength
    0.4,   // radius
    0.85,  // threshold
  )
  composer.addPass(bloom)

  // Star field background
  const starGeo = new THREE.BufferGeometry()
  const starCount = 2000
  const starPositions = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount * 3; i++) {
    starPositions[i] = (Math.random() - 0.5) * 1500
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.6 })
  scene.add(new THREE.Points(starGeo, starMat))

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
