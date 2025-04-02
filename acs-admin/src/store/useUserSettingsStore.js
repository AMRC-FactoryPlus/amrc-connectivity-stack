/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { defineStore } from 'pinia'

export const useUserSettingsStore = defineStore('usersettings', {
  state: () => ({
    useYaml: false,
  }),
  actions: {
    setUseYaml(useYaml) {
      this.useYaml = useYaml
    }
  },
  persist: {
    enabled: true,
  }
})
