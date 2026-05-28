This module is a dynamic subscription manager for notify streams. 

# Why? 
This utility module exists to solve this problem:
```
    "I have a changing set of resources.
    For every currently-present resource, 
    maintain a live notify WATCH/SEARCH subscription.
    Automatically clean it up when the resource disappears."
```

## The core problem
Suppose you have:
```
    Observable<Set<DeviceId>>
```
coming from somewhere like:
```
    notify.search("/notify/v2/devices/")
```
The set changes over time:
```
    t0: {}
    t1: {A}
    t2: {A, B}
    t3: {B}
```

You want:
| Device appears | Action |
| -------- | ------- |
| A appears | start WATCH A members |
| B appears | start WATCH B members |
| A disappears | stop WATCH A members |

The hard part is: 
- detecting additions/removals
- creating subsriptions
- cleaning up subscriptions
- ensuring notify sends `CLOSE`
- surviving reconnects

This module abstracts all of that. It effectively implements **"resources exist while present in a reactive set"**.

Presence in the set controls:
- subscription creation
- websocket WATCH creation
- remote server state
- cleanup
- CLOSE messages


# Walktrhough
## `startStops(sets)`

This function is purely:

### set differencing
It watches changing `Immutable.Set`s and emits lifecycle events. 

### Example input
```
    sets
```

emits:
```
    Set()
    Set("A")
    Set("A", "B")
    Set("B")
```

### Internally

1. **Compare previous and current sets**
    ```
        rx.pairwise()
    ```

    creates:
    ```
        [{}, {A}]
        [{A}, {A, B}]
        [{A, B}, {B}]
    ```

2. **Compute differences**
    ```
        then.subtract(now)
    ```
    finds removals. 

    ```
        now.subtract(then)
    ```
    finds addtions. 


### Result
The stream becomes:
```
    [true, "A"]   // started
    [true, "B"]   // started
    [false, "A"]  // stopped
```

### Then partition
```
    rx.partition(changes, ch => ch[0])
```
splits into:

#### starts
```
    "A"
    "B"
```

#### stops
```
    "A"
```

## `fromStartStops(starts, stops, factory)`
This function transforms lifecycle events into managed notify subscriptions. 

When an item starts:
```
    factory(item)
```
creates a notify observable. 

When the item stops: 
```
    takeUntil(stopper)
```
unsubscribes from it.


without this utility you would need: 
```
    Map<item, Subscription>
```
manual bookkeeping:

```
    if(!subs.has(item))
        subs.set(item, subscribe(...))

    if(removed(item))
        subs.get(item).unsubsribe
        subs.delete(item)
```
plus reconnect handling. 

This utility makes it declarative. 

## `mapStartStops(factory)`
This is just ergonomic composition:
```
    sets.pipe(
            mapStartStops(item => 
            notify.watch(`notify/v2/foo/${item}`)
        ),
        rx.mergeAll()
    )
```

instead of manually writing:
```
    const [starts, stops] = startStops(sets)

    fromStartStops(starts, stops, ...)
```
