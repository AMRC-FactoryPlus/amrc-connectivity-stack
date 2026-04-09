/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { defineStore } from 'pinia'
import { useI3xClient } from '@composables/useI3xClient.js'
import { openI3xStream } from '@composables/useI3xSSE.js'
import { SPARKLINE_HISTORY_SECS } from '@/lib/visualiser/constants.js'

function generateClientId () {
  return 'acs-vis-' + crypto.randomUUID()
}

// Run async tasks with limited concurrency
async function mapConcurrent (items, concurrency, fn) {
  const results = []
  let index = 0
  async function worker () {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

const MAX_CONCURRENT = 6
const MAX_DEPTH = 20  // Effectively unlimited - we stop based on type, not depth
const ISA95_TYPE = 'isa95-level'  // Only recurse into ISA-95 hierarchy nodes

export const useVisualiserStore = defineStore('visualiser', {
  state: () => ({
    // Tree structure
    nodes: new Map(),       // elementId -> { node, parentId, childIds, depth }
    rootIds: [],
    loading: false,
    loaded: false,

    // Live values from SSE
    values: new Map(),      // elementId -> { value, quality, timestamp }
    // Track update counts per leaf for "most active" targeting
    updateCounts: new Map(), // leafId -> count
    clientId: generateClientId(),
    subscriptionId: null,
    streaming: false,
    _streamController: null,

    // History cache (only for nodes near camera)
    history: new Map(),     // elementId -> { points: [], fetching: false, lastFetch: 0 }
  }),

  getters: {
    leafIds (state) {
      const leaves = []
      for (const [id, entry] of state.nodes) {
        if (entry.childIds.length === 0) leaves.push(id)
      }
      return leaves
    },

    /** Nodes to render: ISA95 hierarchy nodes + their direct device children */
    renderableNodes (state) {
      const result = new Map()
      for (const [id, entry] of state.nodes) {
        // Always render ISA95 nodes
        if (!entry.isDevice) {
          result.set(id, entry)
          continue
        }
        // Render devices whose parent is an ISA95 node (direct children of areas)
        const parent = state.nodes.get(entry.parentId)
        if (parent && !parent.isDevice) {
          result.set(id, entry)
        }
      }
      return result
    },
  },

  actions: {
    async loadTree () {
      if (this.loading) return
      this.loading = true
      try {
        const i3x = useI3xClient()
        const roots = await i3x.getObjects({ root: true })

        this.nodes.clear()
        this.rootIds = []

        for (const obj of roots) {
          this.nodes.set(obj.elementId, {
            node: obj,
            parentId: null,
            childIds: [],
            depth: 0,
          })
          this.rootIds.push(obj.elementId)
        }

        // Recursively load all children
        await this._loadChildrenRecursive(this.rootIds, 1)
        this.loaded = true
      } finally {
        this.loading = false
      }
    },

    async _loadChildrenRecursive (parentIds, depth) {
      if (parentIds.length === 0 || depth > MAX_DEPTH) return

      const i3x = useI3xClient()
      const nextLevel = []

      console.log(`Visualiser: loading depth ${depth}, ${parentIds.length} parents...`)

      // Use bulk endpoint: one request per depth level instead of per parent.
      // Note: getRelatedBulk returns body.result via the shared request helper,
      // but the bulk endpoint uses body.results (plural). So we call fetch directly.
      const BATCH_SIZE = 200
      const baseUrl = i3x.baseUrl
      const allResults = []
      for (let i = 0; i < parentIds.length; i += BATCH_SIZE) {
        const batch = parentIds.slice(i, i + BATCH_SIZE)
        try {
          const res = await fetch(`${baseUrl}/objects/related`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ elementIds: batch, relationshiptype: 'i3x:rel:has-children' }),
          })
          const body = await res.json()
          if (body.success && Array.isArray(body.results)) {
            allResults.push(...body.results)
          }
        } catch (e) {
          console.warn(`Visualiser: bulk related failed for batch at depth ${depth}:`, e)
        }
      }

      for (const entry of allResults) {
        if (!entry.success) continue
        const parentId = entry.elementId
        const children = entry.result || []
        const parent = this.nodes.get(parentId)
        if (!parent) continue

        const childIds = []
        for (const child of children) {
          if (!child.elementId) continue
          childIds.push(child.elementId)
          if (!this.nodes.has(child.elementId)) {
            this.nodes.set(child.elementId, {
              node: child,
              parentId,
              childIds: [],
              depth,
              isDevice: child.typeElementId !== ISA95_TYPE,
            })
            // Only recurse into ISA-95 hierarchy nodes - devices are leaf-level for rendering
            if (child.typeElementId === ISA95_TYPE) {
              nextLevel.push(child.elementId)
            }
          }
        }
        parent.childIds = childIds
      }

      console.log(`Visualiser: depth ${depth} done, ${nextLevel.length} children found, ${this.nodes.size} total nodes`)

      if (nextLevel.length > 0) {
        await this._loadChildrenRecursive(nextLevel, depth + 1)
      }
    },

    // --- SSE Subscriptions ---

    async startStreaming () {
      const i3x = useI3xClient()

      const result = await i3x.createSubscription(this.clientId, 'ACS Visualiser')
      this.subscriptionId = result.subscriptionId

      // Cache the set of renderable IDs for fast lookup in _handleStreamData
      this._renderableIds = new Set(this.renderableNodes.keys())

      // We need to register actual leaf metric IDs (not devices).
      // Fetch the full subtree under each device to find leaf IDs,
      // and build a mapping from leaf -> device for the SSE handler.
      this._deviceCache = new Map()
      const deviceIds = []
      for (const [id, entry] of this.renderableNodes) {
        if (entry.isDevice) deviceIds.push(id)
      }

      console.log(`Visualiser: resolving leaf metrics for ${deviceIds.length} devices...`)
      const allLeafIds = []
      const baseUrl = i3x.baseUrl

      // Fetch children recursively for each device to find leaves
      // Use a queue per device, batched
      for (let d = 0; d < deviceIds.length; d += 20) {
        const deviceBatch = deviceIds.slice(d, d + 20)
        await Promise.all(deviceBatch.map(async (deviceId) => {
          const queue = [deviceId]
          const visited = new Set()
          while (queue.length > 0) {
            const batch = queue.splice(0, 50)
            try {
              const res = await fetch(`${baseUrl}/objects/related`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ elementIds: batch, relationshiptype: 'i3x:rel:has-children' }),
              })
              const body = await res.json()
              if (!body.success || !Array.isArray(body.results)) continue
              for (const entry of body.results) {
                if (!entry.success) continue
                const children = entry.result || []
                if (children.length === 0) {
                  // This is a leaf - register it
                  allLeafIds.push(entry.elementId)
                  this._deviceCache.set(entry.elementId, deviceId)
                }
                for (const child of children) {
                  if (!child.elementId || visited.has(child.elementId)) continue
                  visited.add(child.elementId)
                  this._deviceCache.set(child.elementId, deviceId)
                  queue.push(child.elementId)
                }
              }
            } catch { /* skip failed batches */ }
          }
        }))
      }

      console.log(`Visualiser: found ${allLeafIds.length} leaf metrics, registering for SSE...`)
      for (let i = 0; i < allLeafIds.length; i += 100) {
        const batch = allLeafIds.slice(i, i + 100)
        await i3x.registerItems(this.clientId, this.subscriptionId, batch)
      }
      console.log(`Visualiser: registered ${allLeafIds.length} leaves, ${this._renderableIds.size} renderable nodes`)

      this.streaming = true
      this._streamController = openI3xStream(
        i3x.baseUrl,
        this.clientId,
        this.subscriptionId,
        (items) => this._handleStreamData(items),
        () => { this.streaming = false },
      )
    },

    _handleStreamData (items) {
      const arr = Array.isArray(items) ? items : [items]

      for (const item of arr) {
        if (!item.elementId) continue

        // Map the leaf metric to its rendered device node
        let targetId = this._deviceCache?.get(item.elementId) ?? item.elementId
        if (!this._renderableIds?.has(targetId)) continue

        this.values.set(targetId, {
          value: item.value,
          quality: item.quality,
          timestamp: item.timestamp,
        })

        this.updateCounts.set(targetId, (this.updateCounts.get(targetId) || 0) + 1)

        // Append to history if we have an active cache for this node
        const hist = this.history.get(item.elementId)
        if (hist && typeof item.value === 'number') {
          hist.points.push({
            value: item.value,
            timestamp: item.timestamp,
          })
          // Trim old points beyond the sparkline window
          const cutoff = Date.now() - (SPARKLINE_HISTORY_SECS + 10) * 1000
          while (hist.points.length > 0 && new Date(hist.points[0].timestamp).getTime() < cutoff) {
            hist.points.shift()
          }
        }
      }
    },

    // --- History ---

    async fetchHistory (elementId) {
      if (this.history.has(elementId)) return
      const entry = { points: [], fetching: true, lastFetch: Date.now() }
      this.history.set(elementId, entry)

      try {
        const i3x = useI3xClient()
        const end = new Date()
        const start = new Date(end.getTime() - SPARKLINE_HISTORY_SECS * 1000)
        const result = await i3x.getHistory(
          elementId,
          start.toISOString(),
          end.toISOString(),
        )
        if (result?.values) {
          entry.points = result.values
            .filter(v => typeof v.value === 'number')
            .map(v => ({ value: v.value, timestamp: v.timestamp }))
        }
      } catch {
        // History unavailable - sparkline will just show live data
      } finally {
        entry.fetching = false
      }
    },

    evictHistory (elementId) {
      this.history.delete(elementId)
    },

    // --- Cleanup ---

    async cleanup () {
      if (this._streamController) {
        this._streamController.close()
        this._streamController = null
      }
      this.streaming = false

      if (this.subscriptionId) {
        const i3x = useI3xClient()
        try {
          await i3x.deleteSubscription(this.clientId, [this.subscriptionId])
        } catch {
          // Server TTL will clean up
        }
        this.subscriptionId = null
      }

      this.values.clear()
      this.history.clear()
    },
  },
})
