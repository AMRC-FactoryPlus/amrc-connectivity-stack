/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

// Colours - cyan/teal light trail aesthetic
export const BG_COLOUR = 0x000000        // pure black
export const COLOUR_GOOD = 0x00d4aa      // cyan-teal
export const COLOUR_UNCERTAIN = 0xf5a623
export const COLOUR_BAD = 0xf24b5b
export const COLOUR_STALE = 0x334444
export const COLOUR_EDGE = 0x0a4a5a      // dark teal, bloom makes it glow
export const COLOUR_NODE_BRIGHT = 0x44ffdd  // bright node points

// Node radii - very small bright points
export const RADIUS_ROOT = 0.4
export const RADIUS_AREA = 0.25
export const RADIUS_DEVICE = 0.15
export const RADIUS_LEAF = 0.08

// Camera
export const ORBIT_SPEED = 0.015         // rad/s - slightly slower for atmosphere
export const DRIFT_MIN = 0.8
export const DRIFT_MAX = 1.1
export const DRIFT_PERIOD = 60
export const SWEEP_INTERVAL_MIN = 15
export const SWEEP_INTERVAL_MAX = 25
export const SWEEP_EASE_IN = 4
export const SWEEP_HOLD = 15
export const SWEEP_EASE_OUT = 4

// LOD thresholds
export const LOD_LABEL = 20
export const LOD_SPARKLINE_SHOW = 10
export const LOD_SPARKLINE_HIDE = 15

// Particles - light trails
export const PARTICLE_POOL_SIZE = 50
export const PARTICLE_SPEED = 2.0        // seconds leaf-to-root
export const PARTICLE_SIZE = 0.12
export const TRAIL_LENGTH = 2            // number of trail segments
export const TRAIL_COLOUR = 0x44ffdd     // bright cyan trail head
export const TRAIL_COLOUR_TAIL = 0x003322 // dark tail fade

// Sparklines
export const SPARKLINE_WIDTH = 4
export const SPARKLINE_HEIGHT = 2
export const SPARKLINE_HISTORY_SECS = 60
