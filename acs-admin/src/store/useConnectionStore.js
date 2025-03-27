/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from "@amrc-factoryplus/service-client"
import { useStore } from '@store/useStore.ts'

export const useConnectionStore = () => useStore(
    'connection',
    UUIDs.Class.EdgeAgentConnection,
    {
      configuration: {
        app: UUIDs.App.ConnectionConfiguration,
        appBindings: {
          driver: UUIDs.App.DriverDefinition,
          'topology.cluster': UUIDs.App.EdgeClusterConfiguration,
        }
      }
    }
)()