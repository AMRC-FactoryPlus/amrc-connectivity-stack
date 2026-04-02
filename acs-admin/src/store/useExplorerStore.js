/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { defineStore } from 'pinia'
import { useI3xClient } from '@composables/useI3xClient.js'

export const useExplorerStore = defineStore('explorer', {
  state: () => ({
    nodes: new Map(),
    rootIds: [],
    selectedId: null,
    loadingRoots: false,
    loadingChildren: new Set(),
    filter: '',
  }),

  getters: {
    selectedNode (state) {
      if (!state.selectedId) return null
      return state.nodes.get(state.selectedId)?.node ?? null
    },
  },

  actions: {
    async loadRoots () {
      if (this.loadingRoots) return
      this.loadingRoots = true
      try {
        const i3x = useI3xClient()
        const roots = await i3x.getObjects({ root: true })
        this.rootIds = []
        for (const obj of roots) {
          this.nodes.set(obj.elementId, {
            node: obj,
            childIds: [],
            expanded: false,
            loaded: false,
          })
          this.rootIds.push(obj.elementId)
        }
      } finally {
        this.loadingRoots = false
      }
    },

    async expandNode (elementId) {
      const entry = this.nodes.get(elementId)
      if (!entry) return

      entry.expanded = true

      if (entry.loaded) return

      this.loadingChildren.add(elementId)
      try {
        const i3x = useI3xClient()
        const children = await i3x.getRelated(elementId, 'i3x:rel:has-children')
        const childIds = []
        for (const child of children) {
          childIds.push(child.elementId)
          if (!this.nodes.has(child.elementId)) {
            this.nodes.set(child.elementId, {
              node: child,
              childIds: [],
              expanded: false,
              loaded: false,
            })
          }
        }
        entry.childIds = childIds
        entry.loaded = true
      } finally {
        this.loadingChildren.delete(elementId)
      }
    },

    collapseNode (elementId) {
      const entry = this.nodes.get(elementId)
      if (entry) entry.expanded = false
    },

    toggleNode (elementId) {
      const entry = this.nodes.get(elementId)
      if (!entry) return
      if (entry.expanded) {
        this.collapseNode(elementId)
      } else {
        this.expandNode(elementId)
      }
    },

    selectNode (elementId) {
      this.selectedId = elementId
    },
  },
})
