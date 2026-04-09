<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps({
  targetId: { type: String, default: null },
  phase: { type: String, default: null },
  nodes: { type: Map, required: true },
  values: { type: Map, required: true },
})

const visible = ref(false)
const hierarchy = ref([])
const currentValue = ref(null)
const currentQuality = ref(null)
const graphPoints = ref([])
const MAX_GRAPH_POINTS = 120

let graphInterval = null

watch(() => props.targetId, (id) => {
  if (!id) {
    visible.value = false
    clearGraph()
    return
  }

  // Build hierarchy path
  const path = []
  let current = id
  while (current) {
    const entry = props.nodes.get(current)
    if (!entry) break
    path.unshift(entry.node.displayName || current.slice(0, 8))
    current = entry.parentId
  }
  hierarchy.value = path
  graphPoints.value = []

  // Start collecting graph points
  clearGraph()
  graphInterval = setInterval(() => {
    const vqt = props.values.get(id)
    if (vqt && typeof vqt.value === 'number') {
      currentValue.value = vqt.value
      currentQuality.value = vqt.quality
      graphPoints.value.push({ value: vqt.value, time: Date.now() })
      if (graphPoints.value.length > MAX_GRAPH_POINTS) {
        graphPoints.value.shift()
      }
    }
  }, 100)
})

watch(() => props.phase, (phase) => {
  if (phase === 'hold' || phase === 'ease-in') {
    visible.value = true
  } else {
    visible.value = false
    clearGraph()
  }
})

function clearGraph () {
  if (graphInterval) {
    clearInterval(graphInterval)
    graphInterval = null
  }
}

onBeforeUnmount(() => clearGraph())

function graphPath () {
  const pts = graphPoints.value
  if (pts.length < 2) return ''

  const w = 400
  const h = 100
  const pad = 4

  let min = Infinity, max = -Infinity
  for (const p of pts) {
    if (p.value < min) min = p.value
    if (p.value > max) max = p.value
  }
  const range = max - min || 1

  const points = pts.map((p, i) => {
    const x = pad + (i / (MAX_GRAPH_POINTS - 1)) * (w - pad * 2)
    const y = h - pad - ((p.value - min) / range) * (h - pad * 2)
    return `${x},${y}`
  })

  return `M${points.join(' L')}`
}

function formatValue (v) {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'number') {
    return Math.abs(v) >= 1000 ? v.toFixed(1) :
           Math.abs(v) >= 1 ? v.toFixed(3) :
           v.toPrecision(4)
  }
  return String(v)
}
</script>

<template>
  <Transition name="hud">
    <div v-if="visible && targetId" class="hud-frame">
      <!-- Corner brackets -->
      <div class="hud-corner tl" />
      <div class="hud-corner tr" />
      <div class="hud-corner bl" />
      <div class="hud-corner br" />

      <!-- Hierarchy breadcrumb -->
      <div class="hud-hierarchy">
        <span v-for="(name, i) in hierarchy" :key="i" class="hud-crumb">
          <span v-if="i > 0" class="hud-sep">&rsaquo;</span>
          <span :class="{ 'hud-leaf': i === hierarchy.length - 1 }">{{ name }}</span>
        </span>
      </div>

      <!-- Current value -->
      <div class="hud-value">
        <span class="hud-value-number">{{ formatValue(currentValue) }}</span>
        <span v-if="currentQuality" class="hud-quality" :class="currentQuality">{{ currentQuality }}</span>
      </div>

      <!-- Live graph -->
      <div class="hud-graph">
        <svg viewBox="0 0 400 100" preserveAspectRatio="none">
          <path
            v-if="graphPoints.length >= 2"
            :d="graphPath()"
            fill="none"
            stroke="rgba(68, 255, 221, 0.8)"
            stroke-width="1.5"
          />
          <!-- Glow version of the same path -->
          <path
            v-if="graphPoints.length >= 2"
            :d="graphPath()"
            fill="none"
            stroke="rgba(68, 255, 221, 0.2)"
            stroke-width="4"
          />
        </svg>
        <div v-if="graphPoints.length < 2" class="hud-graph-waiting">
          Acquiring data...
        </div>
      </div>

      <!-- Scan line animation -->
      <div class="hud-scanline" />
    </div>
  </Transition>
</template>

<style scoped>
.hud-frame {
  position: absolute;
  bottom: 40px;
  right: 40px;
  width: 420px;
  padding: 16px 20px;
  background: rgba(0, 10, 10, 0.75);
  border: 1px solid rgba(68, 255, 221, 0.3);
  backdrop-filter: blur(4px);
  font-family: 'Courier New', monospace;
  color: rgba(68, 255, 221, 0.9);
}

/* Corner brackets */
.hud-corner {
  position: absolute;
  width: 12px;
  height: 12px;
  border-color: rgba(68, 255, 221, 0.7);
  border-style: solid;
  border-width: 0;
}
.hud-corner.tl { top: -1px; left: -1px; border-top-width: 2px; border-left-width: 2px; }
.hud-corner.tr { top: -1px; right: -1px; border-top-width: 2px; border-right-width: 2px; }
.hud-corner.bl { bottom: -1px; left: -1px; border-bottom-width: 2px; border-left-width: 2px; }
.hud-corner.br { bottom: -1px; right: -1px; border-bottom-width: 2px; border-right-width: 2px; }

.hud-hierarchy {
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 8px;
  line-height: 1.4;
}
.hud-sep {
  margin: 0 4px;
  opacity: 0.4;
}
.hud-leaf {
  color: rgba(68, 255, 221, 1);
  font-weight: bold;
}

.hud-value {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.hud-value-number {
  font-size: 28px;
  font-weight: bold;
  letter-spacing: -0.5px;
  color: rgba(68, 255, 221, 1);
}
.hud-quality {
  font-size: 10px;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid;
}
.hud-quality.Good { border-color: rgba(68, 255, 221, 0.5); }
.hud-quality.Uncertain { color: #f5a623; border-color: rgba(245, 166, 35, 0.5); }
.hud-quality.Bad { color: #f24b5b; border-color: rgba(242, 75, 91, 0.5); }

.hud-graph {
  height: 80px;
  border: 1px solid rgba(68, 255, 221, 0.15);
  background: rgba(0, 20, 20, 0.4);
  position: relative;
  overflow: hidden;
}
.hud-graph svg {
  width: 100%;
  height: 100%;
}
.hud-graph-waiting {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  opacity: 0.4;
}

/* Animated scan line */
.hud-scanline {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(68, 255, 221, 0.3), transparent);
  animation: scanline 3s linear infinite;
}
@keyframes scanline {
  0% { top: 0; }
  100% { top: 100%; }
}

/* Transition */
.hud-enter-active {
  transition: all 0.4s ease-out;
}
.hud-leave-active {
  transition: all 0.3s ease-in;
}
.hud-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.hud-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
