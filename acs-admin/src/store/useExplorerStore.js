/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { defineStore } from 'pinia'
import { useI3xClient } from '@composables/useI3xClient.js'
import { describe_type } from '@/lib/explorer/model.js'

export const useExplorerStore = defineStore('explorer', {
  state: () => ({
    nodes: new Map(),
    // The i3X object types, by elementId. Loaded once; until then an
    // object shows by its type id.
    types: new Map(),
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
    // node => its type as the page shows it (see describe_type).
    typeOf (state) {
      return node => describe_type(node, state.types)
    },
  },

  actions: {
    async loadTypes () {
      try {
        const types = await useI3xClient().getObjectTypes()
        this.types = new Map(types.map(t => [t.elementId, t]))
      }
      catch (err) {
        // The page works without them: objects show by their type id.
        console.warn('Explorer: the i3X object types are not available', err)
      }
    },

    async loadRoots () {
      if (this.loadingRoots) return
      this.loadingRoots = true
      try {
        const i3x = useI3xClient()
        this.loadTypes()
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
        const children = await i3x.getChildren(elementId)
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
