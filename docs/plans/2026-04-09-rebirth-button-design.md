# Rebirth Button in Admin UI

Date: 2026-04-09
Author: Alex Godbehere

## Problem

There is no way to trigger a Sparkplug Rebirth (NBIRTH/DBIRTH) from the
Admin UI. When edge agents get stuck (e.g. after a ConfigDB migration
changes device UUIDs), the only option is to manually restart pods or
use kubectl. A Rebirth button in the UI would let operators force a
re-publish of the birth certificate without restarting the agent.

## Solution

Add a per-row "Rebirth" button to the Node list and Device list views
in the Edge Manager. The button is only shown if the current user has
the Rebirth CCL permission on that specific node/device.

### Key UUIDs

- **Rebirth CCL permission**: `fbb9c25d-386d-4966-a325-f16471d9f7be`
- **Command Definition app**: `60e99f28-67fe-4344-a6ab-b1edb8b8e810`
- **CmdEsc permission set group**: `9584ee09-a35a-4278-bc13-21a8be1f007c`

### How Rebirth works

The `CmdEsc.rebirth(address)` method in `lib/js-service-client/lib/service/cmdesc.js`
sends a Sparkplug NCMD/DCMD via the Command Escalation service:

- For nodes: `Node Control/Rebirth` (Boolean, true)
- For devices: `Device Control/Rebirth` (Boolean, true)

The CmdEsc service validates the user's ACL before forwarding the
command. The edge agent handles the NCMD at
`acs-edge/lib/sparkplugNode.ts:339-341` and re-publishes its birth
certificate.

### Changes

#### 1. Node store  - add Sparkplug address

**File:** `acs-admin/src/store/useNodeStore.js`

Add `sparkplugAddress: UUIDs.App.SparkplugAddress` to the loaded
configs. The device store already loads this; the node store does not.

#### 2. ACL check composable

**File:** `acs-admin/src/composables/useCanRebirth.js` (new)

A Vue composable that, given a list of node/device UUIDs, checks
whether the current user has the Rebirth permission
(`fbb9c25d-386d-4966-a325-f16471d9f7be`) on each target via
`client.Auth.check_acl()`.

Returns a reactive `Map<uuid, boolean>` so the template can look up
each row.

The current user's principal is resolved from `serviceClientStore.username`
(a Kerberos principal name) which `Auth.fetch_acl()` accepts directly.

Calls are made per target UUID. Results are cached for the lifetime of
the composable.

#### 3. Node list  - Rebirth column

**File:** `acs-admin/src/pages/EdgeManager/EdgeClusters/EdgeCluster.vue`
**File:** `acs-admin/src/pages/EdgeManager/EdgeClusters/nodeColumns.ts`

Add a new column to the node DataTable with a Rebirth button per row.
The column uses a custom cell renderer (Vue `h()` function or inline
component) that:

- Checks `canRebirth.get(row.original.uuid)` to show/hide the button
- On click, calls `client.CmdEsc.rebirth(address)` where `address` is
  built from the node's `sparkplugAddress` config
- Shows a loading spinner on the button while the request is in flight
- Shows a success toast on completion, error toast on failure

#### 4. Device list  - Rebirth column

**File:** `acs-admin/src/pages/EdgeManager/Nodes/Node.vue`
**File:** `acs-admin/src/pages/EdgeManager/Nodes/deviceColumns.ts`

Same pattern as the node list. The device's Sparkplug address is already
available in the device store.

### UX

- Button style: small ghost/secondary button with a refresh icon
- Loading: spinner replaces the icon while the request is in flight
- Success: toast "Rebirth sent to {name}"
- Error (403): toast "Permission denied: cannot rebirth {name}"
- Error (other): toast "Failed to rebirth {name}"
- Button hidden entirely if user lacks permission on that target

### What this doesn't change

- No backend changes  - CmdEsc and the edge agent already support Rebirth
- No new permissions  - the Rebirth CCL already exists
- No changes to the Sparkplug protocol handling
