# FplusHttpAuth
This is the authentication gatekeeper middleware for Factory+ HTTP API framework. This class adds authentication to an Express app using 3 mechanisms: 
1. Basic Auth (username/password)
2. Negotiate (Kerberos / GSSAPI) 
3. Bearer tokens (short-lived session tokens issued by `/token`)

It also:
- attaches `req.auth = "<user@realm>"` when authenticated
- blocks unauthenticated requests (except "public" routes)
- manages in-memory token store

## Configuration (instance vars)
- `realm` -> Kerberos realm needed for Basic auth. 
- `principal` -> Server identity (HTTP/host@REALM)
- `keytab` -> Path to Kerberos key file = `/keytabs/server`. `keytab` is a file that contains the server's long-term encrypted secret keys for Kerberos authentication. 
- `session_length` -> Token validity length (ms)
- `tokens` -> In-memory `Map` of bearer tokens. **Important!** These tokens are not persisted, all sessions are lost on restart. 
- `public` -> public routes that skip auth, e.g., `/health`, `/ping`

## Method `setup(app)`
This method does 2 things:
1. Adds `this.auth` to the Express `app` as a middleware so that every request goes through `this.auth(req, res, next)`.
2. Adds a `POST /token` endpoint, which is used to exchange a login for a bearer token.

## Method `auth(req, res, next)`
This is the main middleware. This method:
1. Extracts `Authorisation` header
    ```
        const auth = req.header("Authorization");
    ```
    If `Authorization` header is missing: 
    - allows if route is `public`
    - otherwise rejects with `401`
2. Parses scheme
    ```
        const Auth_rx = /^([A-Za-z]+) +([A-Za-z0-9._~+/=-]+)$/;
    ```
    
    This splits for example `Authorization: Basic dXNlcjpwYXNz` into 
    - `scheme` -> Basic
    - `creds`  -> dXNlcjpwYXNz 
3. Routes by auth type
    `switch(scheme){` for 
    - Basic -> `client = this.auth_basic(ctx)`
    - Negotiate ->  `client = this.auth_gssapi(ctx)`
    - Bearer -> `client = this.auth_bearer(ctx)`
4. Handles failure

    Any error -> same response 
    ```
        401 Unauthorized
        WWW-Authenticate: Basic realm="Factory+"
    ```
    
    `Note!` Even GSSAPI/token failures still return `Basic` challenge header.
5. Attaches the client to the `req.auth`
    On success: 
    ```
        req.auth = client;
        next(); 
    ```

## Method `auth_basic(ctx)`
1. Retrieves credentials

    Converts ASCII to Binary (base64 decode). E.g., `dXNlcjpwYXNz` is split into `user` and `pass`.
    ```
        const [, user, pass] = atob(ctx.creds).match(/^([^:]+):(.+)/);
    ```
    
2. Normalizes username (adds `@realm`)
    ```
        const client = user.includes("@") ? user : `${user}@${this.realm}`;
    ```
3. Verifies password with Kerberos
    ```
        await GSS.verifyCredentials(client, pass, {
            keytab: `FILE:${this.keytab}`,
            serverPrincipal: this.principal,
        });
    ```
    It uses Kerberos infrastructure to validate `username+password` using server's secret key stored in `keytab` file. -> "Use Kerberos infrastructure to verify that **client+password** is valid in the realm, and that I (the server) am authorised to do this check". The Server `keytab` is used as a trust anchor.


## Method `auth_gssapi(ctx)`
This is browser/enterprise SSO.
1. Decodes token
    ```
        const cli_tok = Buffer.from(ctx.creds, "base64");
    ```
2. Sets up Kerberos server context
    ```
        GSS.setKeytabPath(this.keytab);
        const srv_ctx = GSS.createServerContext();
    ```
3. Processes the token
    
    This advances Kerberos handshake.
    ```
        const srv_tok = await GSS.acceptSecContext(srv_ctx, cli_tok);
    ```
    
4. Gets client identity
    ```
        const client = srv_ctx.clientName();
    ```
5. Responds with continuation token
    ```
        ctx.res.header("WWW-Authenticate", "Negotiate " + srv_tok);
    ```


## Method `auth_bearer(ctx)`
1. Looks up the bearer token from the `this.tokens` map, which returns `{principal, expiry}`
    ```
        const client = this.tokens.get(creds);
    ```
    
2. Checks for token expiry
3. Returns `client.principal`


## Method `token(req, res)`
This is a handler for `POST /token` route. It only works if `req.auth` exists, i.o., already authenticated via **Basic** or **Kerberos**.
This method does: 
- Generates 528-bit random base64 encoded token
    ```
        const token = crypto.randomBytes(66).toString("base64");
    ```
2. Stores the token in `this.tokens` map
    ```
        this.tokens.set(token, {
            principal: req.auth,
            expiry: Date.now() + this.session_length,
        });
    ```
3. Returns `token` and its `expiry`
    ```
        return res.json({ token, expiry });
    ```

## Overall request flow
- First login with **Basic** or **Kerberos** which sets `req.auth` to **user@realm**.
- Then, call `/token` which returns Bearer `{token}`.
- Later requests use the Bearer token (`Authorization: Bearer <token>`)
