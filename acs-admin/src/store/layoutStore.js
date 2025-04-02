/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'

export const useLayoutStore = defineStore('layout', {
  state: () => {
    return {
      fullscreen: false,
      ready: true,
    }
  },
  actions: {
    toggleFullscreen (state = null) {
      if (state !== null) {
        this.fullscreen = state
      }
      else {
        this.fullscreen = !this.fullscreen
      }
    },
  },
})
