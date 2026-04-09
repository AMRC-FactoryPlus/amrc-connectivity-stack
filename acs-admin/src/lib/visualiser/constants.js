/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

// Colours - matching the old visualiser style
export const BG_COLOUR = 0x0a0a1a        // dark blue-black for contrast
export const COLOUR_GOOD = 0x009fe3      // AMRC blue
export const COLOUR_UNCERTAIN = 0xf5a623
export const COLOUR_BAD = 0xf24b5b
export const COLOUR_STALE = 0xc8c8c8    // rgb(200,200,200) offline grey
export const COLOUR_EDGE = 0x009fe3      // same as nodes, like old vis

// Node radii - proportional, old vis used radius/9/(depth+3)
export const RADIUS_ROOT = 1.0
export const RADIUS_AREA = 0.6
export const RADIUS_DEVICE = 0.4
export const RADIUS_LEAF = 0.15

// Camera
export const ORBIT_SPEED = 0.02          // rad/s
export const DRIFT_MIN = 0.8             // min distance multiplier
export const DRIFT_MAX = 1.1             // max distance multiplier
export const DRIFT_PERIOD = 60           // seconds per drift cycle
export const SWEEP_INTERVAL_MIN = 15     // seconds between sweeps
export const SWEEP_INTERVAL_MAX = 25
export const SWEEP_EASE_IN = 4           // seconds
export const SWEEP_HOLD = 15             // longer hold to appreciate the data
export const SWEEP_EASE_OUT = 4

// LOD thresholds (distance from camera to node)
export const LOD_LABEL = 30
export const LOD_SPARKLINE_SHOW = 10
export const LOD_SPARKLINE_HIDE = 15     // hysteresis

// Particles
export const PARTICLE_POOL_SIZE = 200
export const PARTICLE_SPEED = 2.0        // seconds leaf-to-root
export const PARTICLE_SIZE = 0.4

// Sparklines
export const SPARKLINE_WIDTH = 4
export const SPARKLINE_HEIGHT = 2
export const SPARKLINE_HISTORY_SECS = 60
