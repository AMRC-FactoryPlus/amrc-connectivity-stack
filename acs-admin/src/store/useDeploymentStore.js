/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useStore } from '@store/useStore.ts'

export const useDeploymentStore = () => useStore('deployment', UUIDs.Class.EdgeDeployment, {
  deployment: {
    app: UUIDs.App.EdgeAgentDeployment,
    appBindings: {
      chart: UUIDs.App.HelmChartTemplate
    }
  },
})()