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

export const useVisualiserStore = defineStore('visualiser', {
  state: () => ({
    // Tree structure
    nodes: new Map(),       // elementId -> { node, parentId, childIds, depth }
    rootIds: [],
    loading: false,
    loaded: false,

    // Live values from SSE
    values: new Map(),      // elementId -> { value, quality, timestamp }
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
      if (parentIds.length === 0) return

      const i3x = useI3xClient()
      const nextLevel = []

      // Load children for all parents at this depth in parallel
      const results = await Promise.all(
        parentIds.map(async (parentId) => {
          try {
            const children = await i3x.getRelated(parentId, 'i3x:rel:has-children')
            return { parentId, children }
          } catch {
            return { parentId, children: [] }
          }
        }),
      )

      for (const { parentId, children } of results) {
        const parent = this.nodes.get(parentId)
        if (!parent) continue

        const childIds = []
        for (const child of children) {
          childIds.push(child.elementId)
          if (!this.nodes.has(child.elementId)) {
            this.nodes.set(child.elementId, {
              node: child,
              parentId,
              childIds: [],
              depth,
            })
            nextLevel.push(child.elementId)
          }
        }
        parent.childIds = childIds
      }

      // Recurse to next level
      if (nextLevel.length > 0) {
        await this._loadChildrenRecursive(nextLevel, depth + 1)
      }
    },

    // --- SSE Subscriptions ---

    async startStreaming () {
      const leaves = this.leafIds
      if (leaves.length === 0) return

      const i3x = useI3xClient()

      const result = await i3x.createSubscription(this.clientId, 'ACS Visualiser')
      this.subscriptionId = result.subscriptionId

      // Register in batches of 100 to avoid huge payloads
      for (let i = 0; i < leaves.length; i += 100) {
        const batch = leaves.slice(i, i + 100)
        await i3x.registerItems(this.clientId, this.subscriptionId, batch)
      }

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
      for (const item of items) {
        this.values.set(item.elementId, {
          value: item.value,
          quality: item.quality,
          timestamp: item.timestamp,
        })

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
