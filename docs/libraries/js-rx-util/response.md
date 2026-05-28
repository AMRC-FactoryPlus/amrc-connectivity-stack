This module implements a small **HTTP response abstraction** using a **monad-style API** inspired by things such as `Optional`, `Result`, or functional programming containers. 

At a high level:
- Every HTTP response becomes an object
- Responses are classified into:
    - **Success** (`200-299`)
    - **Empty** (`404`)
    - **Failure** (everything else)
- You can chain operations without repeatedly checking status codes

# Why? 
Instead of writing:
```
    if(res.status === 200){
        ...
    } else if(res.status === 404){
        ...
    } else{
        throw ...
    }
```

you can write:
```
    Response.of(...)
        .map(...)
        .filter(...)
        .or(...)
        .handle(...)
```
This is the same philosophy as:
- `Promise`
- `Optional`
- `Either`
- `Result`
in functional programming. 


# Walkthrough
## Helper: `_abstract`
```
    function _abstract(){
        throw new TypeError("Abstract method called");
    }
```
Used as a fake "abstract method".
The base `Response` class defines methods that subclasses must override. 

## Known Headers
```
    const Known_Headers = imm.Set("cache-control content-type etag".split());
```
Only these headers are preserved: 
- cache-control
- content-type
- etag
Everything else is discarded.

## HTTPError
```
    class HTTPError extends Error
```
A custom error type that stores: 
```
    this.status = status;
```
So callers can catch errors and inspect the HTTP status. 

Example:
```
    throw new HTTPError(500, "Server crashed");
```

## Core design: Class `Response`
This is the main abstraction. It acts as a wrapper around:
```
    {
        status,
        body,
        headers
    }
```
but with extra behaviour. 

Headers are normalized:
```
    .mapKeys(k => k.toString().toLowerCase())
```
Then filtered to only known headers. 

## Response Types
The factory `static` method `of()` decides which subclass to instantiate:
```
    static of (status, body, headers)
```

| Status    | Type |
| -------- | ------- |
| `200-299`  | `Success` |
| `404` | `Empty` |
| everything else | `Failure` |

Example: 
```
    Response.of(200, {...});
```
-> `new Success(...)`

while: 
```
    Response.of(404, {...});
```
-> `new Empty(...)`

## `ofFetch`
```
    static async ofFetch(res)
```

Converts a fetch API response into this custom `Response`.

```
    const body = await res.json().catch(() => undefined);
```
If JSON parsing fails, body becomes `undefined`.

Then: 
```
    return this.of(res.status, body, res.headers.entries());
```

## `ofNullable`
```
    static ofNullable(value)
```
Converts: 
| Input     | Result |
| -------- | ------- |
| `null`  | Empty |
| `undefined` | Empty |
| anything else | Success |

## Convenience Constructors 

```
    Response.ok(body)
```
-> `200`

```
    Response.empty()
```
-> `404`

```
    Response.error(err)
```
-> 500

## Type Flags
Default:
```
    get isOK() { return false; }
```
Subclasses override them.

## Immutable Transformations
These methods never mutate the response. They return new responses. 

### `withBody`
```
    withBody(body, st)
```
Creates a new response with:
- same headers
- new body
- optional new status

Example:
```
    res.withBody(newData)
```

### `withStatus`
```
    withStatus(st)
```
- same headers
- same body
- different status

## Monad Operations
### `flatMap`

```
    flatMap(fn)
```
Equivalent to:
- Promise `.then`
- Optional `.flatMap`
- Result chaining

Behaviour depends on subclass.

### Success
```
    flatMap(fn) { return fn(this.body); }
```
Calls the function.

### Empty / Failure
```
    flatMap(fn) { return this; }
```
Skips the function. 

This enables pipelines like:
```
    Response.ok(user)
        .map(...)
        .filter(...)
        .flatMap(...)
```
without manually checking errors. 

### `map`
```
    map(fn)
```
Transforms successful bodies. 

Implementation:
```
    return this.flatMap(b => this.withBody(fn(b)));
```

Example:
```
    Response.ok(2).map(x => x * 3)
```
-> `Success(6)`

But: 
```
    Response.empty().map(...)
```
stays empty. 


### `filter`
```
    filter(pred)
```
Keeps successful values only if predicate passes. 

Example: 
```
    Response.ok(5)
        .filter(x => x > 10)
```
-> Empty response.

### `assert`
Like `filter`, but failures become errors. 

```
    Response.ok(5)
        .assert(x => x > 10, "Too small")
```
-> `Failure(500)`

### `or`
Handles empty responses.

Only `Empty` overrides it: 
```
    or(fn) { return fn() }
```
This is like "fallback".

Example: 
```
    findUser(id)
        .or(() => createDefaultUser())
```

### `orWith`
Convenince wrapper: 
```
    orWith(status, body)
```

Example:
```
    res.orWith(403, "Unauthorised");
```

### `handle`
Handles error responses selectively. 

Implemented only by `Failure`.

```
    handle(sts, fn)
```

Example:
```
    res.handle([401, 403], (status, body) => Response.ok("guest"))
```
If status matches: 
- function runs
- new response returned 

otherwise original failure remains. 


### `mapError`
Transforms error statuses.

```
    mapError([404], () => 204)
```

### `throwIfError`
Only implemented by `Failure`
```
    throw new HTTPError(...)
```
Useful for imperative code. 


## Extraction Methods
These pull raw values out.

### `get()`
Behaviour: 
| Type     | Result |
| -------- | ------- |
| Success  | body |
| Empty    | undefined |
| Failure  | throws |


### `orElse(default)`
Behaviour:
| Type     | Result |
| -------- | ------- |
| Success  | body |
| Empty    | default |
| Failure  | throws |


### `ifOK`
Pattern matching style dispatch.
```
    ifOK(success, empty, failure)
```

Example:
```
    res.ifOK(
        body => console.log(body),
        () => console.log("missing"),
        status => console.log("error", status)
    )
```


## Utility Methods
### `uniq`
Assumes body is an array. 

Makes entries unique.
```
    Response.ok([1,1,2]).uniq()
```
-> `[1,2]`

### `single`
Asserts array contains exactly one item. 

```
    Response.ok([42]).single()
```
-> `42`

But: 
```
    Response.ok([1,3]).single()
```
-> error response.


## Express Integration
```
    toExpress(res)
```
Converts this abstraction into an Express response. 

Equivalent to:
```
    res.status(...)
    res.json(...)
    res.end()
```

## Notify Integration
```
    toUpdate(ix)
```
Converts to an ACS notify/v2 sequence of updates. 

## Subclasses
The three subclasses implement behaviour polymorphically. 

### Subclass `Success`
```
    class Success extends Response
```
Key idea: 
- operations continue
- transformation execute

Example: 
```
    flatMap(fn) { return fn(this.body) }
```

### Subclass `Empty`
Represents "not found".

**Design choice**:
```
    404 == empty value
```
not an error. This means `user lookup missing` is considered normal control flow, not an exceptional failure. 

This is very similar to: 
- `Optional.empty()`
- `None`
- nullable semantics

### Subclass `Failure`
- Represents actual errors
- All transformations stop
- Extraction throws exceptions

