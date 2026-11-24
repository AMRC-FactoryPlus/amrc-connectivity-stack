/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Edge Scout constants shared by the Addresses panel, its composable and
 * the driver custom UI host. The UUIDs match the table in
 * docs/architecture/edge-management/edge-scout.md and
 * acs-service-setup/lib/uuids.js.
 */

export const Scout = {
  /* ConfigDB app holding one status entry per connection. */
  StatusApp: 'ad73fae4-a3b9-457a-8c36-12a2019bff2c',
  /* ConfigDB class of snapshot File objects. */
  ResultClass: '10916e96-f6fe-44cc-8c01-16a775426038',
  /* "Scan device addresses", in ACS.PermGroup.CmdEsc. */
  Perm: '41443382-ecad-439b-999f-cb611bc11f7c',
}

/* The NBIRTH metric and NCMD name the Edge Agent understands. */
export const SCOUT_METRIC = 'Node Control/Scout'

/* Wildcard target in an ACL entry. */
export const WILDCARD = '00000000-0000-0000-0000-000000000000'

/* How long the panel waits for the agent to record a request before it
 * says the request went missing. */
export const WAIT_MS = 15000

/* Agent refusal codes, which go in last_request only. */
export const REFUSAL_CODES = [
  'REQUEST', 'UNDEPLOYED', 'NODRIVER', 'LIBRARY', 'BUSY', 'LIMIT', 'NOTRUNNING',
]

/* The plain Sparkplug B type names an item may carry. */
export { ITEM_TYPES } from './snapshot.js'

/* Fixed row height of the address tree, in pixels. */
export const ROW_HEIGHT = 28

/* Most items a driver custom UI can read in one scout-query. */
export const QUERY_LIMIT = 500
