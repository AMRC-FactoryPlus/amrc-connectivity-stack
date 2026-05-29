This module implements **JWT detection and verification** for a service that accepts both:
- opaque session tokens (legacy/random tokens), and
- Keycloak-issued JWT bearer tokens

It uses the `jose` library to validate JWTs agains an OpenID Connect (OIDC) provided.

-------------

# High-level purpose
This module solves 2 problems: 
1. Figure out whether an incoming credential is a JWT
2. Validate JWTs using Keycloak/OpenID Connect discovery + JWKS

# Imports
```
    import {createRemoteJWKSet, jwtVerify} from "jose";
```

From the `jose` library:
- `jwtVerify`
    - verifies signature + claims on a JWT
- `createRemoteJWKSet`
    - downloads signing keys from a JWKS endpoint
    - caches them 
    - handles key rotation

# JWT structure detection
```
    const JWT_DOT_RX =
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
```
This regex checks for the standard JWT format:
```
    header.payload.signature
```
Each segment must be `base64url` characters:
- A-Z
- a-z
- 0-9
- _
- -

and separated by dots. 

Example JWT:
```
    eyJhbGciOiJSUzI1NiJ9
    .
    eyJzdWIiOiIxMjMifQ
    .
    abc123signature
```

# `looks_like_jwt(creds)`
```
    export function looks_like_jwt(creds)
```
This function tries to distinguish JWTs from opaque session tokens. 

### Step 1: check structure
```
    if(!JWT_DOT_RX.test(creds)) return false;
```
If it does NOT look like:
```
    aaa.bbb.ccc
```
It's immediately rejectected.

### Step 2: decode header
```
    const [hdr_b64] = creds.split(".");
```
Gets the first JWT segment 
```
    header.payload.signature
    ^^^^^^
```

### Step 3: parse JSON header
```
    const hdr = JSON.parse(
        Buffer.from(hdr_64, "base64url").toString("utf8"));
```
JWT headers are `base64url`-encoded JSON.

Example decoded header:
```
    {
        "alg": "RS256",
        "typ": "JWT",
        "kid": "abc123"
    }
```

### Step 4. verify `alg`
```
    return typeof hdr.alg === "string";
```
A JWT header should contain an algorithm field. 

This prevents false positives where random string happen to match the regex. 

### Error handling
```
    catch {
        return false;
    }
```

If base64 decoding or JSON parsing fails: 
- not a JWT
- return `false`


### Why this exists? 

> Bearer credentials arrive on the same wire as our opaque session tokens. 

Meaning:

```
    Authorization: Bearer ...
```
may contain either:
- old opaque tokens
- JWTs

This helper allows the server to decide which validation path to use without breaking existing clients. 

# Class `JwtVerifier` 
This class performs real JWT verification. 

## Constructor
Expected options:
```
    {
        discovery_url,
        log
    }
```

- `discovery_url`
    - OpenID discovery endpoint
    
    Example:
    `https://auth.example.com/realms/foo/.well-known/openid-configuration`
- `log`
    - optional logger
    - default to no-op

#### Internal cache state
```
    this._issuer = null;
    this._jwks = null;
    this._discovery = null;
```
These are lazily initialized later. 

## `_discover()`
```
    async discover()
```
This loads OIDC metadata the first time verification is needed. 

### Memoisation / caching
```
    if(this._discovery) return this._discovery;
```
If disovery already started or completed:
- reuse the same promise/result

This avoids:
- duplicate HTTP requests
- race conditions

### Async self-executing promise
```
    this._discovery = (async () => 
```
The function stores the promise immediately.

This is important because concurrent callers all await the same discovery operation. 

### Fetch OIDC discovery document
```
    const res = await fetch(this.discovery_url); 
```
This downloads: 
```
    {
        "issuer": "...",
        "jwks_uri" : "...",
        ... 
    }
```

### Parse JSON
```
    const doc = await res.json();
```

### Validate required fields
```
    if(!doc.issuer || !doc.jwks_uri){
        throw "..."
    }
```
Needs:
- `issuer`
- `jwks_uri`

from the OIDC metadata.

### Store issuer
```
    this._issuer = doc.issuer;
```
Used later for issuer validation. 

### Create remove JWKS
```
    this._jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
```
This is the key part. 

The JWKS endpoint contains public signing keys:
```
    {
        "keys": [...]
    }
```

`createRemoteJWKSet()` returns a function that:
- downloads keys
- caches them
- refreshes on key rotation
- selects correct key by `kid`

All handled automatically by `jose`. 

### Retry behaviour
```
    .catch(e => {
        this._discovery = null;
        throw e
    });
```
If discovery fails temporarily:
- network issue
- auth server restart
- timeout

the failed promise is NOT cached forever. 

Future requests can retry.

Without this, one transient failure could permanently break JWT auth until process restarts. 

## `verify(token)`
```
    async verify (token)
```
Main public API.

### Ensure discovery completed
```
    await this._discover();
```
Guarantees:
- issuer known
- JWKS configured

### Verify JWT
```
    const { payload } = 
        await jwtVerify(token, this._jwks, {
            issuer: this._issuer,
        });
```

`jwtVerify()` checks:
- JWT structure
- signature validity
- expiration (`exp`)
- not-before (`nbf`)
- issuer claim
- key selection via `kid`

using the remote JWKS. 

