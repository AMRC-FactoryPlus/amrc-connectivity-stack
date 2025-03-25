/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from "@amrc-factoryplus/service-client"
import { useStore } from '@store/useStore.js'

export const useDriverStore = () => useStore(
  'driver', 
  UUIDs.Class.EdgeAgentDriver,
  {
    definition: UUIDs.App.DriverDefinition
  }
)()
