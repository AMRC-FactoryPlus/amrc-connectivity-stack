<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick, shallowRef } from 'vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useI3xClient } from '@composables/useI3xClient.js'
import { graph_elements, next_layer } from '@/lib/explorer/model.js'

const props = defineProps({
  elementId: { type: String, required: true },
  displayName: { type: String, default: '' },
})

const emit = defineEmits(['navigate'])

const i3x = useI3xClient()
const containerRef = ref(null)
const cy = shallowRef(null)
const depth = ref(1)
const loading = ref(false)
const maxDepth = 3

async function loadGraph () {
  if (!props.elementId) return
  loading.value = true

  try {
    const cytoscape = (await import('cytoscape')).default

    // One request per step out from the selected object. i3X names
    // the relationship on every edge, so the graph does not guess it.
    const selected = props.elementId
    const layers = []
    const seen = new Set([selected])
    let ids = [selected]
    for (let d = 0; d < depth.value && ids.length; d++) {
      const layer = await i3x.getRelatedBulk(ids).catch(() => [])
      layers.push(layer)
      ids = next_layer(layer, seen)
    }
    // The selection changed while this was read.
    if (selected !== props.elementId) return
    const { nodes, edges } = graph_elements(
      { elementId: selected, displayName: props.displayName }, layers)

    if (cy.value) {
      cy.value.destroy()
      cy.value = null
    }

    await nextTick()

    if (!containerRef.value) return

    cy.value = cytoscape({
      container: containerRef.value,
      elements: {
        nodes,
        edges,
      },
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'background-color': '#e2e8f0',
            'border-width': 2,
            'border-color': '#94a3b8',
            'font-size': '11px',
            'text-wrap': 'ellipsis',
            'text-max-width': '120px',
            'width': 'label',
            'height': 40,
            'padding': '12px',
            'shape': 'round-rectangle',
            'text-outline-color': '#fff',
            'text-outline-width': 2,
          },
        },
        {
          selector: 'node[type="selected"]',
          style: {
            'background-color': '#3b82f6',
            'border-color': '#2563eb',
            'color': '#fff',
            'text-outline-color': '#3b82f6',
            'font-weight': 'bold',
          },
        },
        {
          selector: 'node[type="parent"]',
          style: {
            'border-color': '#f59e0b',
            'border-width': 3,
          },
        },
        {
          selector: 'node[type="child"]',
          style: {
            'border-color': '#22c55e',
            'border-width': 3,
          },
        },
        {
          selector: 'node[type="component"]',
          style: {
            'border-color': '#8b5cf6',
            'border-width': 3,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#cbd5e1',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#cbd5e1',
            'label': 'data(label)',
            'font-size': '9px',
            'color': '#64748b',
            'text-rotation': 'autorotate',
            'text-background-color': '#fff',
            'text-background-opacity': 1,
            'text-background-padding': '2px',
          },
        },
      ],
      layout: {
        name: 'breadthfirst',
        directed: true,
        roots: `#${CSS.escape(props.elementId)}`,
        spacingFactor: 1.5,
        padding: 30,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    })

    cy.value.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id()
      if (nodeId !== props.elementId) {
        emit('navigate', nodeId)
      }
    })

    cy.value.on('mouseover', 'node', (evt) => {
      if (evt.target.id() !== props.elementId) {
        containerRef.value.style.cursor = 'pointer'
      }
    })
    cy.value.on('mouseout', 'node', () => {
      containerRef.value.style.cursor = 'default'
    })
  } finally {
    loading.value = false
  }
}

function fitGraph () {
  cy.value?.fit(undefined, 30)
}

watch(() => props.elementId, loadGraph)
watch(depth, loadGraph)
onMounted(loadGraph)

onBeforeUnmount(() => {
  if (cy.value) {
    cy.value.destroy()
    cy.value = null
  }
})
</script>

<template>
  <Card>
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base">Relationship Graph</CardTitle>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 text-sm text-slate-500">
            <span>Depth:</span>
            <input
              type="range"
              :min="1"
              :max="maxDepth"
              v-model.number="depth"
              class="w-20 accent-slate-600"
            />
            <span class="font-mono w-4 text-center">{{ depth }}</span>
          </div>
          <Button variant="ghost" size="sm" @click="fitGraph" title="Fit to view">
            <i class="fa-solid fa-expand"></i>
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent class="p-0">
      <div class="relative">
        <div
          v-if="loading"
          class="absolute inset-0 flex items-center justify-center bg-white/80 z-10"
        >
          <i class="fa-solid fa-spinner fa-spin text-slate-400"></i>
        </div>
        <div ref="containerRef" class="h-[350px] w-full"></div>
      </div>
      <div class="flex items-center gap-4 px-4 py-2 border-t text-xs text-slate-500">
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-blue-500 inline-block"></span> Selected</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded border-2 border-amber-500 bg-slate-100 inline-block"></span> Parent</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded border-2 border-green-500 bg-slate-100 inline-block"></span> Child</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded border-2 border-violet-500 bg-slate-100 inline-block"></span> Component</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded border-2 border-slate-400 bg-slate-100 inline-block"></span> Related</span>
      </div>
      <div class="px-4 pb-2 text-xs text-slate-400">
        Each line is labelled with the i3X relationship, read in the arrow's direction.
      </div>
    </CardContent>
  </Card>
</template>
