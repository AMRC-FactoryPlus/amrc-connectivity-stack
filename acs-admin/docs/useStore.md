# useStore

The `useStore` utility creates reactive stores for Factory+ objects with
automatic binding resolution. It supports both eager (immediate) and
lazy (on-demand) binding of related data.

## Basic Usage

The store factory takes three arguments:
- `name`: A unique identifier for the store
- `classUUID`: The Factory+ class UUID to watch
- `appBindings`: (Optional) Configuration for eager binding resolution

```javascript
import { UUIDs } from "@amrc-factoryplus/service-client"
import { useStore } from '@store/useStore.ts'

// Create a basic store
export const useDeviceStore = () => useStore(
  'device',
  UUIDs.Class.Device,
  {
    deviceInformation: UUIDs.App.DeviceInformation
  }
)()
```

## Eager Binding

Eager bindings are resolved immediately when the store starts. They are defined in the `appBindings` parameter:

```javascript
// Store with eager bindings
export const useConnectionStore = () => useStore(
  'connection',
  UUIDs.Class.EdgeAgentConnection,
  {
    // Simple binding
    configuration: UUIDs.App.ConnectionConfiguration,
    
    // Nested binding with references
    configuration: {
      app: UUIDs.App.ConnectionConfiguration,
      appBindings: {
        driver: UUIDs.App.DriverDefinition,
        'topology.cluster': UUIDs.App.EdgeClusterConfiguration,
      }
    }
  }
)()
```

In this example:
- The base object's `configuration` field is bound to `ConnectionConfiguration`
- Within that configuration:
  - The `driver` field is resolved using `DriverDefinition`
  - The nested `topology.cluster` field is resolved using `EdgeClusterConfiguration`

## Lazy Binding

Lazy bindings are resolved on-demand using the `loadAdditionalBindings` method:

```javascript
const deviceStore = useDeviceStore()

// Later, when needed:
await deviceStore.loadAdditionalBindings(deviceUuid, {
  'deviceInformation.node': UUIDs.App.EdgeAgentDeployment
})
```

Lazy bindings can be cleared when no longer needed:

```javascript
await deviceStore.clearAdditionalBindings(deviceUuid)
```

## Store Lifecycle

The store provides several lifecycle methods:

```javascript
const store = useDeviceStore()

// Start watching for changes
await store.start()

// Wait for store to be ready
await store.storeReady()

// Stop watching and clean up
store.stop()
```

## Store State

The store maintains the following state:

```typescript
interface StoreState {
  data: StoreData[]        // Array of objects with resolved bindings
  loading: boolean         // Loading state
  ready: boolean          // Ready state
  rxsub: Subscription     // Main subscription
  additionalBindings: Map // Lazy binding subscriptions
}
```

## Best Practices

1. Use eager bindings for data that is always needed
2. Use lazy bindings for:
   - Occasionally needed data
   - Data that might create circular dependencies
   - Performance optimization

3. Always clean up lazy bindings when they're no longer needed
4. Wait for `storeReady()` before accessing store data

## Example Usage in Components

```vue
<script>
import { useDeviceStore } from '@store/useDeviceStore'
import { storeReady } from '@store/useStoreReady'

export default {
  setup() {
    const deviceStore = useDeviceStore()
    return { d: deviceStore }
  },

  computed: {
    device() {
      return this.d.data.find(e => e.uuid === this.deviceId) || {}
    }
  },

  methods: {
    async loadDeploymentInfo() {
      await this.d.loadAdditionalBindings(this.device.uuid, {
        'deviceInformation.node': UUIDs.App.EdgeAgentDeployment
      })
    }
  },

  async mounted() {
    await storeReady(this.d)
  }
}
</script>
```