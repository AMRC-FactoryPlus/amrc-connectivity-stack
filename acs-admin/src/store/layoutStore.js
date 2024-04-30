import { defineStore } from 'pinia'

export const useLayoutStore = defineStore('layout', {
  state: () => {
    return {
      fullscreen: false,
    }
  },
  actions: {
    toggleFullscreen() {
      this.fullscreen = !this.fullscreen
    }
  }
})
