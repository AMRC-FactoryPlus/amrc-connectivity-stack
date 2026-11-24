/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The Gateway Depot's records of its gateways, read from the ConfigDB.
 * The edge cluster page uses them to tell a cluster that a gateway is
 * setting up from one that needs bootstrapping by hand. */

import { useStore } from '@store/useStore.ts'
import { GatewayDepot } from '@/lib/gateway-depot/constants.js'

export const useDepotGatewayStore = () => useStore('depot-gateway', GatewayDepot.Class.Gateway, {
    gateway: GatewayDepot.App.Gateway,
})()
