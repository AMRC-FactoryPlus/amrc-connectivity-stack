/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { useStore } from '@store/useStore.ts'
import { UUIDs } from '@amrc-factoryplus/service-client'

export const useNodeStore = useStore('node', UUIDs.Class.EdgeAgent, {
  deployment: UUIDs.App.EdgeAgentDeployment
})