This module implements an **Optional monad** in JS. Similar to:
- Java's `Optional`
- Rust's `Option`
- Haskell's `Maybe`

This module creates a safe wrapper around possibly missing values, allowing functional chaining (`map`, `flatMap`, `filter`) without repetitive null checks. 

## Monad
**Monad** is a design pattern used to handle data operations *securely* and *sequentially*. It essentially serves as a wrapper that allows you to chain a series of functions together. 

It automatically handles background complexities: 
- managing state
- handling errors (e.g., `null` values)
- performing I/O operations

without forcing you to constantly write checks.

# High-level structure
The **idea** is to wrap a value in an object that explicitly represents either:
- a value that exists (`Present`)
- no value exists (`EMPTY`)

There are 2 possible states:
1. `Optional.EMPTY`
2. `Optional.Present`

The user creates Optional with `Optional.of(value)`.

Examples:
```
    Optional.of(42)        // Present(42)
    Optional.of(null)      // EMPTY
    Optional.of(undefined) // EMPTY
```

# Why? 
Instead of doing this:
```
if (user && user.address && user.address.postcode){
    ...
}
```

You can do:
```
Optional.of(user)
    .map(u => u.address)
    .map(a => a.postcode)
    .orElse("unknown");
```
If anything becomes `null` or `undefined`, the chain safely becomes empty. 

# Walkthrough
## `Optional.of()`
```
    statis of(val){
        if(val == null)
            return EMPTY;
        else 
            return new Present(val);
    }
```


`== null` intentionally matches BOTH: `null` and `undefined`. So,
```
    Optional.of(5);
```
returns:
```
    new Present(5)
```
while:
```
    Optional.of(null);
```
returns the singleton:
```
    EMPTY
```

## Base Class `Optional` 
The base `Optional` class represents the **empty** case. Most methods here return "do nothing" behaviour. 

Example: 
```
    map(fn) {
        return this.flatMap(v => Optional.of(fn(v)));
    }
```
But empty `flatMap` is:
```
    flatMap(fn){
        return this;
    }
```
So mapping an empty optional just retursn empty. 

## Subclass `Present`
```
    class Present extends Optional
```
Represents a value that exists. 

Stores the value:
```
    this.value = val;
```
Overrides methods with meaningful behaviour. 

### `isPresent`
Default:
```
    get isPresent(){ return false; }
```

Present version:
```
    get isPresent(){ return true; }
```

Usage:
```
    Optional.of(5).isPresent    // true
    Optional.of(null).isPresent // false
```

### `map()`
```
    map(fn){
        return this.flatMap(v => Optional.of(fn(V)));
    }
```
Transforms a contained value.

```
    Optional.of(fn(v))
```
This means if the mapper returns `null` or `undefined` the result becomes empty automatically. 

Exmaple:
```
    Optional.of(5)
        .map(x => x * 2)
```
-> `Present(10)`

### `flatMap()`
Base version:
```
    flatMap(fn) { return this; }
```

Present version:
```
    flatMap(fn) { return fn(this.value); }
```

`flatMap` expects the callback itself to return an `Optional`.

Example: 
```
    Optional.of(5)
        .flatMap(s => Optional.of(x * 2))
```
-> `Present(10)`


Difference between `map` and `flatMap`:
| Method | Callback returns |
| ------ | ------- |
| `map` | plain value |
| `flatMap` | Optional |

Without `flatMap`, you'd get nested optionals.

### filter()
```
    filter(fn){
        return this.flatMap(v => fn(v) ? this : EMPTY);
    }
```
Keeps the value only if condition passes. 

Example: 
```
    Optional.of(10)
        .filter(x => x > 5)
```
-> `Present(10)`

Example: 
```
    Optional.of(3)
        .filter(x => x > 5)
```
-> `EMPTY`

### `or()`
```
    or(fn) { return fn(); }
```

For `EMPTY` Optional: 
- call fallback supplier

For `Present` Optional:
```
    or(fn) { return this; }
```
Meaning: 
- if value exists, ignore fallback

Example:
```
    Optional.of(null)
        .or(() => Optional.of(42))
```
-> `Present(42)`

### `ifPresentOrElse()`
`EMPTY` version:
```
    ifPresentOrElse(present, absent){
        return absent();
    }
```

`Present` version:
```
    ifPresentOrElse(p, a){
        return p(this.value);
    }
```
Patter-match style branching.

Example:
```
    Optional.of(5)
        .ifPresentOrElse(
            v => console.log(v),
            () => console.log("empty")
        );
```

### `get()`
Empty:
```
    get() { return null; }
```

Present:
```
    get() { return this.value; }
```
Returns raw value.

Some Optional implementations avoid exposing this because it can reintroduce null problems. 


### `orElseGet()`
```
    orElseGet(fn){
        return this.ifPresentOrElse(v => v, fn);
    }
```
If Present:
- return value

Otherwise:
- compute fallback lazily

Example: 
```
    Optional.of(null)
        .orElseGet(() => expensiveCalculation());
```

### `orElse()`
```
    orElse(val){
        return this.orElseGet(() => val);
    }
```
Simple fixed default. 

Example:
```
    Optional.of(null).orElse(0);
```
-> `0`

### `orElseThrow()`
```
    orElseThrow(fn){
        return this.orElseGet(() => {throw fn(); });
    }
```
Throws custom exception if empty.

Example: 
```
    Optional.of(null)
        .orElseThrow(() => new Error("Missing"));
```

## Why use a singleton `EMPTY`?
```
    const EMPTY = new Optional();
```
All empty optionals reuse the same object. 

Benefits: 
- less allocation
- immutable shared instance
- simpler equality semantics

## Monad aspect
This is called a monad because:
- values are wrapped in a context (`Optional`)
- operations chain safely with `map`/`flatMap`

The key property:
```
    Optional.of(x)
        .flatMap(f)
        .flatMap(g)
```
lets computations propagate emptiness automatically. 

No explicit null checks needed. 

## Example flow
```
    Optional.of(user)
        .map(u => u.address)
        .map(a => a.postCode)
        .filter(pc => pc.startsWith("S"))
        .orElse("unknown")
```
Step-by-step:
1. Wrap user
2. Extract address
3. Extract poscode
4. Keep only Sheffield-style postcodes
5. Fallback if anything missing

