This module exports 2 utility functions:
1. `forward(dest)` - Express internal request forwarding middleware. 
2. `jmp_match(cand, filter)` - recursive JSON merge-path style matching. 

# `forward(dest)`
```
    export function forward(dest)
```
This creates Express middleware for internally forwarding a request to another route. 


### Purpose
Instead of redirecting the browser/client with HTTP 302, this rewrites the request internally and lets Express handle it again. 

Think of it like: 
> "Pretend this request was originally sent to another route."


### Split destination path
```
    const pieces = dest.split("/");
```

Example:
```
    dest = "/api/users/:id/profile"
```

becomes:
```
    ["", "api", "users", ":id", "profile"]
```

### Returned middleware
```
    return (req, res, next) => {
```
This returns a standard Express middleware function. 

### Build new URL
```
    req.url = pieces
        .map(p => p[0] == ":"
            ? req.params[p.slice(1)]
            : p)
        .join("/");
```
This rewrites the request URL. 

#### Dynamic parameter replacement
If a path segment starts with `:`, it pulls a value from `req.params`.

Example:
```
    dest = "/users/:id"
```

and:
```
    req.params.id = 42
```

Then:
```
    "/users/42"
```
is generated. 


`p.slice(1)` removes the leading colon: `":id".slice(1)` -> `"id"`


### Logging
```
    req.log?.("FORWARD: -> %s", req.url);
```

### Internal Express dispatch
```
    req.app.handle(req, res);
```
This is the key part. 

Instead of:
```
    next()
```
it directly asks the Express app to process the modified request again. 

So Express routing restarts using the new `req.url`.


### Example usage
#### Route setup
```
    app.get("/old/:id", forward("/new/:id"));
```
Request `GET /old/123` becomes internally `GET /new/123` without the client knowing. 

#### This is **internal forwarding**, not redirecting. 
The browser URL stays `/old/123` but Express handles `/new/123`. 


# `jmp_match(cand, filter)`

```
    export function jmp_match(cand, filter){
```
This performs recursive matching using JSON Merge Patch semantics. 

```
    Values match if a merge-patch of the filter onto the candidate would make no change.
```
Meaning
> Does the candidate already satisfy this patch/filter, meaning applying that patch would not change anything? 
    >> It's checking *idempotence under merge-patch rules*.


### Basic idea
This acts as a recursive partial-object matcher. This function is used to check if the stored object `cand` already matches the desired patch `filter`.

> Would applying this filter-as-a-patch change `cand` at all? 
- if YES -> returns `false` 
- if NO (already satisfied) -> returns `true`

### Primitive comparison
```
    if(filter === null || typeof(filter) != "object")
        return cand === filter;
```
If the filter is: 
- primitive
- null
- string
- number
- boolean

then strict equality is required. 

Examples:
```
    jmp_match(5,5)      // true
    jmp_match(5,6)      // false
    jmp_match("a", "a") // true
```

### Array comparison
```
    if(Array.isArray(filter))
        return deep_equal(cond, filter);
```
Arrays must match exactly. 

So: 
```
    [1,2]
```
does NOT partially match:
```
    [1,2,3]
```

### Object matching 
```
    for (const [k, v] of Object.entries(filter)){
```
Iterate through all filter properties. 

#### Special null semantics
```
    if(v === null)
        if(k in cand)
            return false;
```
This mirrors JSON Merge Patch deletion semantics. 

In merge-patch:
```
    {
        "x": null
    }
```
means:
> remove property `x`

So matching requires:
```
    cand MUST NOT contain x
```

Example:
```
    cand = { a: 1 }
    filter = { b: null }
```
-> matches (`b` absent)

But: 
```
    cand = { b: 2 }
    filter = { b: null }
```
-> fails

### Recursive matching
```
    else {
        if(!(k in cand) || !jmp_match(cand[k], v))
            return false;
    }
```
For non-null values:
1. Property must exist
2. Value must recursively match 

### Conceptually
This behaves similar to: 
- structural pattern matching
- Mongo-style partial matching
- JSON Merge Patch validation

but with strict array equality and null-as-deletion semantics. 

### Useful for
- filtering JSON documents
- permissions/config matching 
- patch validation
- querying partial structures

