/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { defineStore } from 'pinia'
import { useI3xClient } from '@composables/useI3xClient.js'
import { openI3xStream } from '@composables/useI3xSSE.js'

function generateClientId () {
  return 'acs-admin-' + crypto.randomUUID()
}

const MAX_TREND_POINTS = 60

export const useMonitorStore = defineStore('monitor', {
  state: () => ({
    clientId: generateClientId(),
    subscriptionId: null,
    items: new Map(),
    newCount: 0,
    dialogOpen: false,
    streaming: false,
    _streamController: null,
  }),

  getters: {
    hasItems: (state) => state.items.size > 0,
    itemList: (state) => Array.from(state.items.entries()).map(([id, item]) => ({ elementId: id, ...item })),
  },

  actions: {
    async subscribe (elementId, displayName) {
      if (this.items.has(elementId)) return

      const i3x = useI3xClient()

      if (!this.subscriptionId) {
        const result = await i3x.createSubscription(this.clientId, 'ACS Admin Monitor')
        this.subscriptionId = result.subscriptionId
      }

      await i3x.registerItems(this.clientId, this.subscriptionId, [elementId])

      this.items.set(elementId, {
        displayName,
        value: null,
        quality: null,
        timestamp: null,
        trend: [],
      })

      if (!this.streaming) {
        this._startStream()
      }
    },

    async unsubscribe (elementId) {
      if (!this.items.has(elementId)) return

      const i3x = useI3xClient()

      if (this.subscriptionId) {
        await i3x.unregisterItems(this.clientId, this.subscriptionId, [elementId]).catch(() => {})
      }

      this.items.delete(elementId)

      if (this.items.size === 0) {
        this._stopStream()
        if (this.subscriptionId) {
          await i3x.deleteSubscription(this.clientId, [this.subscriptionId]).catch(() => {})
          this.subscriptionId = null
        }
      }
    },

    async unsubscribeAll () {
      const i3x = useI3xClient()
      this._stopStream()

      if (this.subscriptionId) {
        await i3x.deleteSubscription(this.clientId, [this.subscriptionId]).catch(() => {})
        this.subscriptionId = null
      }

      this.items.clear()
      this.newCount = 0
    },

    openDialog () {
      this.dialogOpen = true
      this.newCount = 0
    },

    closeDialog () {
      this.dialogOpen = false
    },

    _startStream () {
      if (this.streaming || !this.subscriptionId) return

      const i3x = useI3xClient()
      this.streaming = true

      this._streamController = openI3xStream(
        i3x.baseUrl,
        this.clientId,
        this.subscriptionId,
        (items) => this._handleStreamData(items),
        () => { this.streaming = false },
      )
    },

    _stopStream () {
      if (this._streamController) {
        this._streamController.close()
        this._streamController = null
      }
      this.streaming = false
    },

    _handleStreamData (streamItems) {
      for (const item of streamItems) {
        const existing = this.items.get(item.elementId)
        if (!existing) continue

        existing.value = item.value
        existing.quality = item.quality
        existing.timestamp = item.timestamp

        if (typeof item.value === 'number') {
          existing.trend.push({
            value: item.value,
            timestamp: Date.now(),
          })
          if (existing.trend.length > MAX_TREND_POINTS) {
            existing.trend.shift()
          }
        }

        if (!this.dialogOpen) {
          this.newCount++
        }
      }
    },

    async cleanup () {
      this._stopStream()
      if (this.subscriptionId) {
        const i3x = useI3xClient()
        try {
          await i3x.deleteSubscription(this.clientId, [this.subscriptionId])
        } catch {
          // Server TTL will clean up
        }
      }
    },
  },
})
