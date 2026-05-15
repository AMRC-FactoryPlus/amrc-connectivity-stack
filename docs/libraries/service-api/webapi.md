# WebAPI

This module is a HTTP framework wrapper built on top of Express with custom
- logging
- authentication
- error handling
- route setup

It is essentially a reusable "web API server scaffold". 

## Configuration (instance vars)
- `max_age` -> Cache-Control max age for GET requests
- `ping_response` -> JSON returned by `/ping`
- `port` -> HTTP port (default 80)
- `routes` -> function that registers application routes
- `log` -> logging function (defaults to `console.log`)
- `body_limit` -> max request body size (default 100kb)
- `body_type` -> `json` or `raw`

## Authentication setup
```
    this.auth = new FplusHttpAuth({
        ...opts,
        log: (req, res, ...args) => (req.log ?? this.log)(...args),
    });
```
- Creates an authentication handler
- Passes all options (`opts`) into it
- Overrides logging so auth logs go through request-specific logger if available. 


## Method `init()`
This is a server construction pipeline. This is the most important function. It wires together
- middleware
- auth
- routes
- error handling

1. Sets up CORS
`app.use(cors({ credentials: true, maxAge: 86400 }));`
Enables:
- Cross-origin requests
- Cookies/credentials allowed
- Preflight cache of 24 hours
2. Parses body of the appropriate type: `json` or `raw`
Supports both:
- normal JSON (`application/json`)
- JSON Patch / Merge Path (`application/merge-path+json`)
3. Request logging middleware
`app.use((req, res, next) => {...`
This is a custom logging layer. It creates:
    - A per-request log buffer
        `let buf = [];` -> so logs are collected not immediately printed. 
    - Request-scoped logger
        `req.log = (...args) => buf.push(args);`
            so, that inside route handlers can do `req.log("something...")`
    - failure helper
        ```
        req.fail = (status, ...args) => {
            req.log(...args);
            throw {status};
        };
        ```
    - when response completes flushes buffer to global logger
        ```
        res.on("finish", () => {
            req.log("<<< %s %s", res.statusCode, res.getHeader("Content-Type"));
            buf.forEach(a => this.log(...a));
        });
        ```
    This ensures logs are grouped per request.  


## Authentication middleware
`this.auth.setup(app);`

This injects custom authentication (`FplusHttpAuth`) into Express. 


## Ping endpoint
`app.get("/ping", this.ping.bind(this));`

This is a simple health check "public" route. 


## Cache-Control middleware
```
if (this.max_age) {
    const cc = `max-age=${this.max_age}`;
    app.use((req, res, next) => {
        if (req.method == "GET")
            res.header("Cache-Control", cc);
        next();
    });
}
```

If enabled, adds only for GET requests `Cache-Control: max-age=<value>`
This prevents caching POST/PUT responses. 


## Route registration 
`this.routes(app);` this expects the app to have routes. This means that `WebAPI` is just a shell; real functionality is injected. 

## 404 handler (catch-all)
`app.use((req, res, next) => next(new APIError(404)));`

If no route matches: 
- create 404 error
- forward to error handler


## Error handling middleware
`app.use((err, req, res, next) => {`
This is Express's global error handler. 
1. logs error `console.error(err);`
2. avoids double responses 
```
if (res.headersSent)
    return next(err);
```
3. Decide status code
```
const st =
    err instanceof APIError         ? err.status
    : err instanceof ServiceError   ? 503
    : 500;
```
Meaning: 
- `APIError` -> use provided 