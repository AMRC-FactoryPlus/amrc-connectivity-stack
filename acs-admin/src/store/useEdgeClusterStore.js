/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useStore } from '@store/useStore.ts'

export const useEdgeClusterStore = () => useStore(
  'edge-cluster',
  UUIDs.Class.EdgeCluster,
  {
    // Basic cluster info
    info: UUIDs.App.Info,
    // Cluster configuration including sparkplug name, namespace, and helm chart
    configuration: {
      app: UUIDs.App.EdgeClusterConfiguration,
      appBindings: {
        chart: UUIDs.App.HelmChartTemplate
      }
    },
    // Cluster status including hosts and kubeseal cert
    status: UUIDs.App.EdgeClusterStatus,
    // Setup status for tracking bootstrap progress
    setupStatus: UUIDs.App.EdgeClusterSetupStatus
  }
)()
