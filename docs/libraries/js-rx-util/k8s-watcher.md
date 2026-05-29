This module builds a reactive wrapper around the Kubernetes watch API using `RxJS` and `Immutable.js`.

# Overview
- It connects to the Kubernetes API
- Performs an initial LIST request
- Starts a WATCH stream for updates
- Converts everything into RxJS observables
- Maintains live in-memory state as an immutable map
- Automatically reconnects on errors

# Custom Error Type
```
    export class K8sError extends Error{}
```

# Class `K8sWatcher`
```
    export class K8sWatcher {
```

This class encapsulates:
- Kubernetes client setup
- LIST operations
- WATCH streams
- RxJS transformation logic


## Constructor
Expected options:
```
{
    k8s,
    kubeconfig,
    restart,
    debounce, 
    errors
}
```

### Internal properties
```
    this.k8s = opts.k8s;
    this.kc = opts.kubeconfig;
```
References to Kubernetes client modules/config.

### Retry timinig
```
    this.restart = opts.restart ?? 5000;
```
If the watch fails: 
- wait 5 seconds 
- reconnect

### Debouncing
```
    this.debounce = opts.debounce ?? 100;
```
Live state updates are delayed slightly to avoid flooding subscribers. 

### Error callback
```
    this.errors = opts.errors ?? (e => {});
```
Optional hook for logging watch failures. 

### Kubernetes helpers
```
    this.watcher = new this.k8s.Watch(this.kc);
```
Creates Kubernetes watch client. 


```
    this.objs = this.k8s.KubernetesObjectApi.makeApiClient(this.kc);
```
Creates generic object API client. 


## `path_for()`
```
    async path_for(opts)
```
Builds the REST endpoint path for a Kubernets resource. 

Example:
```
    {
        apiVersion: "v1",
        kind: "ConfigMap",
        namespace: "default"
    }
```

-> `/api/v1/namespaces/default/configmaps`

Example:
```
    {
        apiVersion: "apps/v1",
        kind: "Deployment",
        namespace: "default"
    }
```
-> `/apis/apps/v1/namespaces/default/deployments`

### Resource lookup
```
    const res = await this.objs.resource(opts.apiVersion, opts.kind);
```
This discovers metadata about the resource type:
- plural name
- whether it's namespaced
- etc. 

Example: 
```
    ConfigMap -> configmaps
    Deployment -> deployments
```

### Namespace validation
```
    if(have_ns && !res.namespaced)
        throw new K8sError(...)
```
Prevents invalid requests like:
```
    ClusterRole inside namespace foo
```
because `ClusterRole` is cluster-scoped. 

### API prefix logic 
```
    const apis = opts.apiVersion.includes("/") ? "apis" : "api";
```
Kubernetes has two API roots:
1. Core API:
    Resources in the original/core API use:
    ```
        /api/v1
    ```
    Examples:
        - Pods
        - ConfigMaps
        - Secrets
        - Services
    
    These have API versions like `v1` withtout `/`. Example URL `api/v1/namespaces/default/pods` 

2. Named APIs:
    Everything else uses:
    ```
        /apis/<group>/<version>
    ```
    Examples:
    | Resource    | apiVersion |
    | -------- | ------- |
    | Deployment  | apps/v1    |
    | Ingress | networking.k8s.io/v1     |
    | CronJob    | batch/v1    |

    - these contain `/`
    - form is `group/version`
    
    Example URL `/apis/apps/v1/namespaces/default/deployments`

#### Why Kubernets designed it this way?
Historically:
- `/api/v1` was the original Kubernetes API
- later they added API groups
- grouped APIs were put under `/apis`

So Kubernetes ended up with:
```
    /api
    /apis
```
both existing permanently.


## `watch()`
```
    watch(path, query)
```
Wraps Kubernetes WATCH into an RxJS Observable. 

### Observable creation
```
    return new rx.Observable(obs => {
```
Creates a "cold" observable:
- nothing happens until subscribed

### Start Kubernetes watch
```
    const reqp = this.watcher.watch(...)
```

The Kubernetes client:
- opens HTTP stream
- emits events continuously

### Event callback
```
    (type, obj) => obs.next([type, obj])
```
Transforms Kubernetes watch events into Rx stream values. 

### Cleanup / unsubscribe
```
    return () => reqp.then(req => req.abort());
```
Critical RxJS integration detail to prevent leaked connections. When subscriber unsubscribes:
- abort underlying HTTP watch request


## `list_and_watch()`
This is the most important method.
```
    list_and_watch(opts)
```
It combines:
1. Initial LIST request
2. Continuous WATCH updates

This is the canonical Kubernetes watch pattern.

### Why LIST + WATCH?
WATCH alone is **unsafe**. You might miss events between:
- app startup
- watch connection establishment

So Kubernetes best practice is:
1. LIST all objects
2. Remember `resourceVersion`
3. WATCH from that version onward

This method implementes exactly that. 

### Deferred execution
```
    return rx.defer(async () => {
```
Important RxJS pattern. This ensures: 
- every subscriber gets a fresh LIST
- retries re-run everything

Without `defer`, retries would reuse stale promises. 

### Initial list
```
    const list = await this.objs.list(...)
```
Fetch current state. 

### Watch path
```
    const path = await this.path_for(opts);
```
Build Kubernetes endpoint. 

### Backward compatibility
```
    return [list.body ?? list, path];
```
Older Kubernetes client versions returned:
```
    { body: actualResult }
```
Newer versions return result directly. 

### RxJS pipeline
```
    .pipe(
        rx.mergeMap(([initial, path]) => rx.concat(
```
After initial fetch resolves, create a stream composed of
1. CLEAR marker
    Signals:
        > discard all previous cached state
    Useful during reconnects. 
2. Initial objects 
    ```
        rx.from(initial.items.map(i => ["ADDED", i]))
    ```
    Converts existing resources into synthetic `ADDED` events. 
    
    Example: 
        ```
            ["ADDED", pod1]
            ["ADDED", pod2]
        ```
        This normalises LIST and WATCH into one event stream. 
3. Live watch stream
    ```
        this.watch(path, {
            resourceVersion: initial.metadata.resourceVersion
        })
    ```
    Starts watching from the exact snapshot version.

    Prevents missed updates. 


## `track_objects()`
This turns event streams into live state. 

Input:
```
    CLEAR
    ADDED 
    MODIFIED
    DELETED
```

Output:
```
    Immutable.Map(current objects)
```

### Default options
```
    opts = {
        key: obj => obj.metadata.uid,
        value: obj => obj,
        equal: imm.is,
        ...opts
    };
```
Customizable mapping logic. 

#### `key`
Determines object identity.

Default:
```
    metadata.uid
```

Could be overriden to:
```
    obj.metadata.name
``` 


#### `value`
Transforms stored object.

Default:
- store full object

Could store reduced projection: 
```
    obj => obj.status
```

#### `equal`
Used for change detection.

Default:
```
    imm.is
```
Immutable structural equality. 


### Retry forever
```
    forever(this.restart, this.errors)
```
This makes the watcher self-healing. 


### Normalise events
```
    rx.map(([act, obj]) => 
```
Transforms:
```
    ["ADDED", obj]
```
into:
```
    ["ADDED", key, value]
```
except CLEAR. 

### State accumulation with `scan`
```
    rx.scan(...)
```
`scan` is RxJS equivalent of `reduce`, but emits intermediate state continuously. 


### CLEAR
```
    new imm.Map()
```
Reset state.

### DELETED
```
    nodes.delete(key)
``` 
Remove object. 

### ADDED / MODIFIED
```
    nodes.set(key, value)
```
Insert/update object. 

### Distinct state suppression
```
    rx.distinctUntilChanged(opts.equal)
```
Prevents redundant emissions.

Important because:
- Kubernetes can emit noisy updates
- projections may collapse changes

### Debounce state suppression
```
    rx.debounceTime(this.debounce)
```
Wait briefly before emitting final state. 

This coalesces bursts like:
```
    MODIFIED
    MODIFIED
    MODIFIED
```
into one update. 

Very useful for UI/state synchonisation.


# Wrapper Function
```
    export function k8sWatch(opts){
        return new K8sWatcher(opts).track_objects(opts);
    }
```


## Example usage
```
    const pods$ = k8sWatch({
        k8s, 
        kubeconfig,
        apiVersion: "v1",
        kind: "Pod",
        namespace: "default",
    });

    pods$.subscribe(pods => {
        console.log(pods.toJS());
    });
```
This would continuously emit the current set of Pods in the namespace. 

