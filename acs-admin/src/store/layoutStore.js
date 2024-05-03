import { defineStore } from 'pinia'

export const useLayoutStore = defineStore('layout', {
  state: () => {
    return {
      fullscreen: false,
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
