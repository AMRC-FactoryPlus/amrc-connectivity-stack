/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from "@amrc-factoryplus/service-client"
import { useStore } from '@store/useStore.js'

export const useConnectionStore = () => useStore(
  'connection', 
  UUIDs.Class.EdgeAgentConnection,
  {
    configuration: UUIDs.App.ConnectionConfiguration,
  }
)()