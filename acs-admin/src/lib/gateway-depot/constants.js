/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The Gateway Depot's well-known UUIDs. These must match the
 * `GatewayDepot` group in acs-service-setup/lib/uuids.js. */

export const GatewayDepot = {
  Service: '4e298f74-4ae9-4da6-ba80-7a08de4036a6',
  Class: {
    Gateway: 'e763cbcd-157c-40d5-8e54-87c0647d9e07',
  },
  App: {
    Gateway: 'a67ed556-80e0-43d2-bd6e-3d25122b9a80',
  },
  Perm: {
    Provision: 'f8a2ad0a-6a2f-4b1a-b8fe-958e7b01fd94',
  },
}

/* How often the list of gateways is fetched while a page is open. */
export const POLL_MS = 2500

/* The edge cluster list is fetched again once it is this old. */
export const CLUSTERS_MAX_AGE_MS = 30 * 1000

/* A port tile shows that its cable or address changed for this long. */
export const LINK_EVENT_MS = 20 * 1000

/* How often to ask whether the depot stick is built, until it is. */
export const STICK_POLL_MS = 15 * 1000
