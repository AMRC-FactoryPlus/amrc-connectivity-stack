/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useStore } from '@store/useStore.ts'

export const useBridgeStore = () => useStore('bridge', UUIDs.Class.Bridge, {
    deployment: {
        app: UUIDs.App.EdgeAgentDeployment,
        appBindings: {
            chart: UUIDs.App.HelmChartTemplate
        }
    },
})()
