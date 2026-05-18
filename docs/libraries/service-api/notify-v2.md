# Notify
This implements a WebSocket-based notification API for Factory+ Service HTTP API. 
- Accpets WebSocket clients 
- Authenticates them using a Bearer token
- Lets clients create subscriptions
- Streams live updates back to the client
- Supports:
    - WATCH 
    - SEARCH

## Architecture
There are 5 major concepts: 
| Component    | Purpose |
| -------- | ------- |
| Notify  | Main WebSocket server |
| Session | Once connected client |
| WatchFilter | Watch a single resource |
| SearchFilter | Watch/search collections |
| RxJS pipelines | Stream updates reactively |

## Protocol
The client opens a WebSocket: 
```
ws://server/notify/v2
```
Then:
1. authenticate
2. send subscription requests
3. receive streamed updates

The connection supports MULTIPLE simultaneous subscriptions. Each subscription has a UUID.

## Imports
- `deep_equal` is used to suppress duplicate updates.
- `immutable` (persistent immutable collections) is used mainly for tracking search result sets safely . 
- `Optional` (Java-style Optional wrapper) allows chaining instead of `if`s. E.g., 
```
Optional.of(x)
    .map(...)
    .filter(...)
```
- `pathToRegexp` converts route patterns into regexes. E.g., `/users/:id` becomes regex matching `/users/123` with captured parameter `123`.
- `rxjs`
- `ws` Node websocket implementation.
- `@amrc-factoryplus/rx-util` custom helper operators around RxJS

## Authentication token regex
`const Token_rx = /^Bearer ([A-Za-z0-9+/]+)$/;`
This validates first WebSocket auth message, e.g., `Bearer abcdef123`

## Class `PathFilter`
This is a base class for route matching. 

### method `checkPath(path)`
This method implements the core route matching logic. 
1. Wraps path safely `Optional.of(path)`
2. Attempts regex match `.map(p => this.regex.exec(p))`. E.g., `/devices/123` against `/devices/:id`, and returns regex match array.
3. Extracts captured params `.map(m => m.slice(1).map(decodeURIComponent))`. E.g., `["123"]`
4. Returns partially-applied handler. This line injects the `match` into the handler `.map(match => (...args) => this.handler(...args, ...match));`.

## Class `WatchFilter extends PathFilter`
This class handles WATCH subscriptions. 

Default watched HTTP method is GET `this.method = opts.method ?? "GET"`.

This protocol introduces virtual method `WATCH` meaning **continuously observe this resource** instead of fetch once. 

### method `head_req(req)`
This method emulates HTTP HEAD semantics for subscriptions. 

For "Normal" HTTP:
GET  = headers + body
HEAD = headers only

For notify if subscription request method is `HEAD` they:
- convert internally to `GET`
- strip response bodies later

### method `head_filter(seq)`
This method takes observable stream of updates and removes body payload to make them equivalent to HEAD semantics. E.g., input update:
```
{
    response: {
        status: 200,
        body: {...}
    }
}
```

becomes 

```
{
    response: {
        status: 200
    }
}
```


### method `handle(session, sub)`
This is the main WATCH request processor. It returns an observable stream if route matches or `undefined`.
1. Only WATCH requests are handled `.filter(s => s.method === "WATCH")`
2. Normalises HEAD behaviour `.map(s => this.head_req(s.request))`
3. Ensures route supports method `.filter(r => r.method == this.method)`
4. Attempts path match `.flatMap(req => this.check_path(req.url))`
5. Returns observable stream of updates `.map(handle => req.filter(handle(session)))`

## Class `SearchFilter extends PathFilter`
This class handles SEARCH subscriptions. This is more advanced than WATCH. 

- WATCH: observe one resource
- SEARCH: observe dynamic collection membership

### method `build_search(src, filter)`
This method builds a streaming search pipeline. 

**Core Concept**
- searches are stateful
- tracks which children currently match
- tracks changes over time

- `src.updates` - underlying stream of child updates
- `rx.startWith({ status: 201, child: true })` this injects synthetic initial event to force initial full state load
- `src.acl` - permission uopdates. If permissions change -> visible resource may change dynamically
- `rxx.asyncState(false, async ( child_ok, u ) => {` - maintains async state across stream and tracks whether client already has child state loaded with `child_ok`. 
- important logic
    ```
    const rv = u.child && !child_ok 
            ? await src.full().then(o => ({ ...o, status: u.status }))
            : u;
    ```
    Meaning, if child update arrives, but client lacks full child state, then fetch full object first instead of incremental patch. 
    Why? 
Incremental updates only make sense if client already knows baseline state. This preserves consistency. 
- updates async state tracker `return [rv.child || rv.children, rv];`


### method `search_filter(filter)`
This method filters search results dynamically. 
If (optional) filter is passed:
1. **Matching predicate**
    ```
    const want = r => 
        r.status < 300 && 
        jmp_match(r.body, filter);
    ```
    A result matches if:
    - successful response
    - JSON body matches filter spec
2. Stateful filtering
    ```
    rxx.withState(imm.Set(), ...)
    ```
    Maintains immutable set of currently matching children. 

3. Parent updates
    ```
    if (!u.child)
    ```
    Means whole collection update. 

4. Child updates
    Otherwise -> one item changed.

5. Dynamic membership tracking 
    ```
    const nkids = want(u.response)
        ? okids.add(child)
        : okids.delete(child)
    ```
    If item now matches -> add to set.
    Otherwise -> remove from set.
6. Three possible outcomes:
    1) Newly matches `rx.of(u)`. Emit update.
    2) No longer matches
    ```
    rx.of({
        status: 200,
        child,
        response: { status: 412 }
    })
    ```
    412 is used as `resource no longer satisfies search criteria`. 
    3) Still doesn't match -> `rx.EMPTY` emit nothing. 


## Class Session 
This class represents ONE connected WebSocket client. 

### Constructor
```
this.ws = opts.ws;
```
Raw WebSocket connection. 

```
this.authn = opts.notify.api.auth;
```
Reuses HTTP auth system from `WebAPI`. 

```
this.uuid = uuidv4()
```
Server-side session identifier. 

### method start()
This is the main session lifecycle. 
- Logs connections/disconnection
- Authenticates the client
- Starts streaming updates

### method `authenticate_client()`
This is a WebSocket auth handshake. 
1. Waits for first message, which MUST contain auth
```
const msg = await new Promise(...)
```
Converts event-based WS API into Promise. Waits for first message or first error. 

2. Authenticates with Bearer token
```
await this.authn.auth_bearer({
    creds: creds[1]
})
```

3. Success reponse
```
ws.send("200");
```
Returns the `principal`.

### method `build_updates()`
This is the heart of the system. It transforms client subscription requests into live update streams. 

- **partition()**
    ```
    const [closes, opens] = rx.partition(
        this.requests(),
        r => r.method == "CLOSE"
    );
    ```
    Separates: 
    - subscription opens
    - subscription closes

- **mergeMap()**
For every new subscription: 
```
rx.mergeMap(req => ...)
```
create a dedicated Observable pipeline. 




...


## Class Notify
Top-level API manager. 

### handlers 
```
this.handlers = []; 
```
Stores routes. 

### method `watch(path, handler)`
Registers watch endpoints. 

### method `search(path, handler)`
Registers search endpoints.

### method `run()`
Starts WebSocket server. 
```
path: "/notify/v2"
```


### method `new_client()`
Creates Session object per connection. 