This module defines two custom operators for RxJS Observables. Both operators add the idea of **persistent state** while processing a stream of values. 

## `withState`
```
    export function withState(initial, accum)
```
This creates a reusable RxJS operator that can be used inside `.pipe()`:
```
    source.pipe(
        withState(...)
    )
```
### Why?
Normally, RxJS operators process one value at a time. `withState` enables:
- remember previous information (`state`)
- update that state for every incoming value
- emit a different transformed value downstream

It behaves similarly to RxJS `scan`, but:
| Operator    | Keeps state | Emits state |
| -------- | ------- | ------- |
| `scan`  | yes    | yes |
| `withState` | yes     | no |

`withState` stores internal state but emits only the transformed output. 

### Structure
```
    return upstream => new rx.Observable(subscriber => {
```
This returns a function that:
- accepts an upstream Observable
- creates a new Observable wrapping it

This is how custom RxJS operators are usually written. 

### Initial state
```
    let state = initial
```
The operator stores mutable state locally. 

Example: initial represents a counter
```
    initial = 0
```

### Subscribing to upstream
```
    return upstream.subscribe({
```
The operator subscribes to the source Observable and forwards events downstream. 

### Processing each value
```
    next(value){
        const [st, val] = accum(state, value);
        state = st;
        subscriber.next(val);
    }
```
For every incoming value:
1. Call the accumulator:
    ```
        accum(currentState, incomingValue)
    ```
2. The accumulator returns: 
    ```
        [newState, outputValue]
    ```
3. Save the new state:
    ```
        state = st;
    ```
4. Emit the transformed value:
    ```
        subscriber.next(val);
    ```

### Error and completion forwarding
```
    error(err) { subscriber.error(err) },
    complete() { subscriber.complete() },
```
Errors and completion are simply passed through unchanged. 

## (@deprectated) `asyncState` 
This is an `async` version of `withState`. This function is **deprecated** because it does not handle concurrency correctly. 
