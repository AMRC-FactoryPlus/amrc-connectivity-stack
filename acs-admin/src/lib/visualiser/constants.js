/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

// Colours
export const BG_COLOUR = 0x0a0a1a
export const COLOUR_GOOD = 0x009fe3
export const COLOUR_UNCERTAIN = 0xf5a623
export const COLOUR_BAD = 0xf24b5b
export const COLOUR_STALE = 0x888888
export const COLOUR_EDGE = 0x1a2a4a

// Node radii
export const RADIUS_ROOT = 3.0
export const RADIUS_AREA = 1.5
export const RADIUS_DEVICE = 0.8
export const RADIUS_LEAF = 0.2

// Camera
export const ORBIT_SPEED = 0.02          // rad/s
export const DRIFT_MIN = 0.6             // min distance multiplier
export const DRIFT_MAX = 1.2             // max distance multiplier
export const DRIFT_PERIOD = 60           // seconds per drift cycle
export const SWEEP_INTERVAL_MIN = 30     // seconds between sweeps
export const SWEEP_INTERVAL_MAX = 45
export const SWEEP_EASE_IN = 5           // seconds
export const SWEEP_HOLD = 8
export const SWEEP_EASE_OUT = 5

// LOD thresholds (distance from camera to node)
export const LOD_LABEL = 40
export const LOD_SPARKLINE_SHOW = 15
export const LOD_SPARKLINE_HIDE = 20     // hysteresis

// Particles
export const PARTICLE_POOL_SIZE = 200
export const PARTICLE_SPEED = 2.0        // seconds leaf-to-root
export const PARTICLE_SIZE = 0.15

// Sparklines
export const SPARKLINE_WIDTH = 4
export const SPARKLINE_HEIGHT = 2
export const SPARKLINE_HISTORY_SECS = 60
