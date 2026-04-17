# Rebirth Button Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Add per-row Rebirth buttons to the Node and Device lists in the Admin UI Edge Manager, gated by CmdEsc ACL permissions.

**Architecture:** A new composable checks ACL permissions per target. The node and device column definitions each get a new "actions" column with a Rebirth button component. The button calls `CmdEsc.rebirth()` and shows loading/success/error states.

**Tech Stack:** Vue 3, TanStack Table, Pinia, `@amrc-factoryplus/service-client` (CmdEsc, Auth)

**Key UUIDs:**
- Rebirth CCL permission: `fbb9c25d-386d-4966-a325-f16471d9f7be`

---

### Task 1: Add sparkplugAddress to node store

**Files:**
- Modify: `acs-admin/src/store/useNodeStore.js`

**Step 1: Add sparkplugAddress config**

The node store currently loads only `deployment`. Add `sparkplugAddress` to match the device store pattern.

Current code:
```js
export const useNodeStore = useStore('node', UUIDs.Class.EdgeAgent, {
  deployment: UUIDs.App.EdgeAgentDeployment
})
```

New code:
```js
export const useNodeStore = useStore('node', UUIDs.Class.EdgeAgent, {
  deployment: UUIDs.App.EdgeAgentDeployment,
  sparkplugAddress: UUIDs.App.SparkplugAddress
})
```

**Step 2: Commit**

```bash
git add acs-admin/src/store/useNodeStore.js
git commit -m "admin: add sparkplugAddress to node store"
```

---

### Task 2: Create RebirthButton component

**Files:**
- Create: `acs-admin/src/components/EdgeManager/RebirthButton.vue`

**Context:** This is a small button component that:
- Accepts props: `address` (Sparkplug address string like `group/node` or `group/node/device`), `name` (display name for toasts), `canRebirth` (boolean)
- If `canRebirth` is false, renders nothing
- On click, calls `useServiceClientStore().client.CmdEsc.rebirth(address)` - note that `rebirth()` accepts a string address as well as an Address object (it's interpolated into the URL via template literal)
- Shows a loading spinner during the request
- Shows success/error toast via `vue-sonner`
- Stops click event propagation (so it doesn't trigger row click navigation)

The button style should match the existing ghost button pattern in the codebase (see `EdgeCluster.vue:133-135` for the Re-Bootstrap button as reference).

**Step 1: Create the component**

```vue
<template>
  <Button
    v-if="canRebirth"
    size="xs"
    variant="ghost"
    title="Rebirth"
    :disabled="loading"
    class="flex items-center justify-center gap-1.5"
    @click.stop="rebirth"
  >
    <i class="fa-solid" :class="loading ? 'fa-circle-notch animate-spin' : 'fa-rotate'"></i>
  </Button>
</template>

<script>
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { Button } from '@components/ui/button/index.js'
import { toast } from 'vue-sonner'

export default {
  components: { Button },
  props: {
    address: { type: String, required: true },
    name: { type: String, required: true },
    canRebirth: { type: Boolean, default: false },
  },
  data () {
    return { loading: false }
  },
  methods: {
    async rebirth () {
      this.loading = true
      try {
        await useServiceClientStore().client.CmdEsc.rebirth(this.address)
        toast.success(`Rebirth sent to ${this.name}`)
      } catch (e) {
        if (e.status === 403) {
          toast.error(`Permission denied: cannot rebirth ${this.name}`)
        } else {
          toast.error(`Failed to rebirth ${this.name}`)
        }
        console.error(e)
      } finally {
        this.loading = false
      }
    }
  }
}
</script>
```

**Step 2: Commit**

```bash
git add acs-admin/src/components/EdgeManager/RebirthButton.vue
git commit -m "admin: add RebirthButton component"
```

---

### Task 3: Create useCanRebirth composable

**Files:**
- Create: `acs-admin/src/composables/useCanRebirth.js`

**Context:** This composable checks whether the current user has the Rebirth CCL permission (`fbb9c25d-386d-4966-a325-f16471d9f7be`) on a list of target UUIDs. It uses `Auth.check_acl()` which accepts a Kerberos principal string directly (see `lib/js-service-client/lib/service/auth.js:107-110`).

The composable takes a reactive list of target UUIDs and returns a reactive `Map<uuid, boolean>`.

**Step 1: Create the composable**

```js
import { ref, watch } from 'vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'

const REBIRTH_PERMISSION = 'fbb9c25d-386d-4966-a325-f16471d9f7be'

export function useCanRebirth (targets) {
  const permissions = ref(new Map())

  watch(targets, async (uuids) => {
    if (!uuids || uuids.length === 0) return

    const s = useServiceClientStore()
    const results = new Map()

    await Promise.all(uuids.map(async (uuid) => {
      try {
        const allowed = await s.client.Auth.check_acl(
          s.username,
          REBIRTH_PERMISSION,
          uuid,
          false
        )
        results.set(uuid, allowed)
      } catch {
        results.set(uuid, false)
      }
    }))

    permissions.value = results
  }, { immediate: true })

  return permissions
}
```

**Step 2: Commit**

```bash
git add acs-admin/src/composables/useCanRebirth.js
git commit -m "admin: add useCanRebirth composable"
```

---

### Task 4: Add Rebirth column to node list

**Files:**
- Modify: `acs-admin/src/pages/EdgeManager/EdgeClusters/nodeColumns.ts`
- Modify: `acs-admin/src/pages/EdgeManager/EdgeClusters/EdgeCluster.vue`

**Context:** The node DataTable uses `nodeColumns` for its column definitions. We need to add an actions column that renders a `RebirthButton`. The button needs the Sparkplug address (from the node's `sparkplugAddress` config) and the ACL check result.

The `sparkplugAddress` config value is an object like `{ group: "...", node: "..." }`. The CmdEsc URL expects `group/node` as a string.

**Step 1: Add actions column to nodeColumns.ts**

Add a new column after the `hostname` column:

```ts
{
    id: 'actions',
    header: () => null,
    cell: ({ row }) => {
        const addr = row.original.sparkplugAddress
        if (!addr) return null
        const addressStr = `${addr.group}/${addr.node}`
        return h(RebirthButton, {
            address: addressStr,
            name: row.original.name,
            canRebirth: row.original._canRebirth ?? false,
        })
    },
    enableSorting: false,
    enableHiding: false,
}
```

Add the import at the top of nodeColumns.ts:
```ts
import RebirthButton from '@/components/EdgeManager/RebirthButton.vue'
```

**Step 2: Wire up ACL checks in EdgeCluster.vue**

In `EdgeCluster.vue`, import and use the composable:

```js
import { useCanRebirth } from '@/composables/useCanRebirth.js'
import { computed } from 'vue'
```

In `setup()`:
```js
const n = useNodeStore()
const nodeUuids = computed(() => n.data?.map(e => e.uuid) ?? [])
const canRebirthMap = useCanRebirth(nodeUuids)
```

In the `nodes` computed property, augment each node with the permission:
```js
nodes () {
  const filtered = Array.isArray(this.n.data)
    ? this.n.data.filter(e => e.deployment?.cluster === this.cluster.uuid)
    : []
  return filtered.map(n => ({
    ...n,
    _canRebirth: this.canRebirthMap?.get(n.uuid) ?? false
  }))
},
```

Expose `canRebirthMap` from setup by returning it alongside the other values.

**Step 3: Commit**

```bash
git add acs-admin/src/pages/EdgeManager/EdgeClusters/nodeColumns.ts
git add acs-admin/src/pages/EdgeManager/EdgeClusters/EdgeCluster.vue
git commit -m "admin: add Rebirth button to node list"
```

---

### Task 5: Add Rebirth column to device list

**Files:**
- Modify: `acs-admin/src/pages/EdgeManager/Nodes/deviceColumns.ts`
- Modify: `acs-admin/src/pages/EdgeManager/Nodes/Node.vue`

**Context:** Same pattern as Task 4. The device store already has `sparkplugAddress`. The device Sparkplug address includes the device name: `{ group: "...", node: "...", device: "..." }`. The CmdEsc URL expects `group/node/device`.

**Step 1: Add actions column to deviceColumns.ts**

Add a new column after the `name` column:

```ts
{
    id: 'actions',
    header: () => null,
    cell: ({ row }) => {
        const addr = row.original.sparkplugAddress
        if (!addr) return null
        const addressStr = `${addr.group}/${addr.node}/${addr.device}`
        return h(RebirthButton, {
            address: addressStr,
            name: row.original.name,
            canRebirth: row.original._canRebirth ?? false,
        })
    },
    enableSorting: false,
    enableHiding: false,
}
```

Add the import:
```ts
import RebirthButton from '@/components/EdgeManager/RebirthButton.vue'
```

**Step 2: Wire up ACL checks in Node.vue**

Same pattern as EdgeCluster.vue - import `useCanRebirth`, create a computed list of device UUIDs, augment the `devices` computed property with `_canRebirth`.

**Step 3: Commit**

```bash
git add acs-admin/src/pages/EdgeManager/Nodes/deviceColumns.ts
git add acs-admin/src/pages/EdgeManager/Nodes/Node.vue
git commit -m "admin: add Rebirth button to device list"
```

---

### Task 6: Manual test

**Steps:**
1. Run the admin UI in dev mode (`cd acs-admin && npm run dev`)
2. Navigate to an edge cluster with nodes
3. Verify Rebirth button appears per-node row (only for nodes the user has permission on)
4. Click Rebirth on a node - verify loading spinner, success toast
5. Navigate into a node to see the device list
6. Verify Rebirth button appears per-device row
7. Click Rebirth on a device - verify loading spinner, success toast
8. Test with a user that lacks Rebirth permission - verify buttons are hidden
