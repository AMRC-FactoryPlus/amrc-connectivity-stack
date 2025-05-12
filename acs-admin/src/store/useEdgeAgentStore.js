/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from "@amrc-factoryplus/service-client"
import { useStore } from '@store/useStore.ts'

export const useEdgeAgentStore = () => useStore(
  'edge-agent',
  UUIDs.Class.EdgeAgent,
  {
    deployment: UUIDs.App.EdgeAgentDeployment
  }
)()