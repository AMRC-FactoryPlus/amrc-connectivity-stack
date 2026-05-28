This module is a small utility library built on top of RxJS. 
It adds convenience helpers for:
- piping observables
- logging
- retry/backoff handling
- replaying latest values
- jittering timers
- caching observables by argument


# `rx_rx()`
```
    function rx_rx(src, ...pipe){
        return rx.pipe(...pipe)(rx.from(src));
    }

    export { rx_rx as rx };
```
This is a helper that:
1. Converts `src` into an Observable using `rx.from`
2. Applies operators with `rx.pipe`

Equivalent to:
```
    rx.from(src).pipe(...)
```
but written in a reusable functional style. 

Example: 
```
    rx_rx(
        [1,2,3], 
        rx.map(x => x * 2),
        rx.filter(x => x > 2)
    )
```
This produces an observable emitting: 
```
    4, 6
```

# `logObserver()`
```
    export function logObserver(log, label){
        return {
            next: v => log("NEXT %s: %o", label, v),
            error: e => log("ERROR %s: %o", label, e),
            complete: () => log("COMPLETE %s", label),
        };
    }

    export { logObserver as log_observer };
```
Creates a standard RxJS observer object for debugging. 

Usage: 
```
    observable.subscribe(
        logObserver(console.log, "my-stream")
    );
```
Output might look like: 
```
    NEXT my-stream: 34
    NEXT my-stream: 9
    COMPLETE my-stream
```
This avoids rewriting logging handlers everywhere. 

# `consoleObserver`
```
    export const consoleObserver = logObserver.bind(null, console.log);

    export { consoleObserver as console_observer };
```
Preconfigured version using `console.log`.

Usage: 
```
    observable.subscribe(consoleObserver("users"));
```

Equivalent to:
```
    logObserver(console.log, "users");
```

# `retryBackoff()`
```
    export function retryBackoff(delay, log)
```
This creates an RxJS retry strategy with exponential backoff. 

## Core behaviour
```
    return rx.retry({
        delay: (err, n) => {
            ...
            return rx.timer(delay * (2 ** p));
        },
        resetOnSuccess: true,
    });
```
When an observable errors:
- wait
- retry 
- wait longer next time
- retry again

### Delay growth
```
    const p = n < 7 ? n - 1 : 6;
```
Retry timing grows like:
| Retry | Delay multiplier |
| ----- | ---------------- |
| 1     | 1×               |
| 2     | 2×               |
| 3     | 4×               |
| 4     | 8×               |
| 5     | 16×              |
| 6     | 32×              |
| 7+    | 64×              |


# `StoppedError`
```
    export class StoppedError extends Error { }
```
Custom error type.

# `forever()`
```
    export function forever(...args)
```
#### Purpose:
> Ensure an observable never stops.

#### Implementation
```
    rx.concatWith(
        rx.throwError(() => new StoppedError(...)
    ))
```
This intentionally throws an error when the observable completes.

Then:
```
    retryBackoff(...args)
```
restarts it. 

## Why? 
Normally an observable can:
- emit values
- complete
- error

But some systems are expected to run forever:
- websocket listeners
- telemetry streams
- PLC subscriptions
- MQTT feeds

If they complete unexpectedly, this helper:
1. Converts completion into an error
2. Retries automatically

Example:
```
    socketStream.pipe(
        forever(1000)
    )
```
If the stream closes: 
- throw `StoppedError`
- reconnect after backoff


# `shareLatest()`
```
    export function shareLatest(...args)
```

#### Purpose
> Share one subscription between many subscribers while remembering the latest value. 

Built using:
```
    rx.share(...)
```
with either:
- BehaviourSubject
- ReplaySubject(1)

### Behaviour
#### With initial value
```
    shareLatest(0)
```
Uses: 
```
    new BehaviourSubject(0)
```
New subscribers instantly receive `0` before real data arrives. 

#### Without initial value
```
    shareLatest()
```
Uses:
```
    new ReplaySubject(1)
```
New subscribers receive the most recent emitted value. 

-----------------------------------------
#### Important settings
`resetOnError: true`

If source errors:
- reset internal state
- allow reconnect/retry

-----------------------------------------

`resetOnComplete: true`

If source completes: 
- reset internal state

-----------------------------------------

`resetOnRefCountZero`
```
    () => rx.timer(1000)
```
If all subscribers unsubscribe:
- wait 1 second
- then disconnect source

This avoids rapid reconnect/disconnect churn. 

------------------------------------------

# `jitterInterval()`
```
    export function jitterInterval(each, jitter)
```
Creates a timer stream with randomness. 

### Behaviour
```
    each + Math.random() * jitter
```

Example: 
```
    jitterInterval(1000, 500)
```
Emits approximately every:
```
    1000ms - 1500ms
```

### Why? 
Useful in distributed systems to avoid synchronisation spikes.

Without jitter:
```
    1000 clients poll exactly every 5 seconds
```
causing traffic bursts.

With jitter requests spread out randomly. 

### Emits
```
    null
```
on each interval. 

It's basically a randomised heartbeat timer.


# `cacheSeq()`

> Caches observables by argument and share subscriptions. 

### Why? 
#### Problem it solves
Suppose:
```
    getUserStream(42)
```

creates: 
- websocket
- polling stream
- database subscription

If multiple consumers call it:
```
    getUserStream(42)
    getUserStream(42)
```
you DON'T want duplicate backend subscriptions. 

Instead, you want:
- one share observable
- cached by argument

That's what `cacheSeq()` does.

### Basic usage
```
    const getCached = cacheSeq(id => 
        fetchUserObservable(id)
    );
```

Now:
```
    const a = getCached(1);
    const b = getCached(1);
```
returns the same shared observable. 

### `rx.defer()`
```
    return arg => rx.defer(() => {...})
```
It ensures:
- cache checked at subscription time
- not function-call time

This prevents stale observables. 

## Observable lifecycle
When cache miss:
```
    const seq = rx_rx(
        opts.factory(arg),
    )
```
create observable from factory. 

Then:
```
    rx.finanlize(() => cache.delete(arg))
```
When observable fully dies:
- remove from cache

