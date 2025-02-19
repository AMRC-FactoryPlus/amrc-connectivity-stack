# Web API boilerplate

```js
import { FplusHttpAuth, WebAPI } from "@amrc-factoryplus/utilities";
```

These classes implement some of the boilerplate required for an HTTP service conforming to the Factory+ framework.

## Authentication

The `FplusHttpAuth` class adds routes to an Express app to handle HTTP authentication. It accepts Basic and Negotiate auth and verifies them against Kerberos; it also creates a path `/token` to issue tokens and accepts these tokens as Bearer auth.

### Constructor

```js
const auth = new FplusHttpAuth({...});
```

Create a new authentication object. Options are:

| Option           | Required? | Meaning                             |
|------------------|-----------|-------------------------------------|
| `realm`          | yes       | Our local Kerberos realm.           |
| `hostname`       | yes       | A hostname we have a key for.       |
| `keytab`         | yes       | The path to our keytab file.        |
| `session_length` | no        | How long are tokens valid for? (ms) |

The keytab file holds our Kerberos keys; this needs to be provided as part of deploying your service. The realm and hostname are used as part of verifying Basic auth; client usernames will have `@${realm}` added if they have no realm part, and we need a key for `HTTP/${hostname}@${realm}` available in the keytab to verify passwords.

The session length defaults to three hours if not supplied.

### Methods

#### `auth`

```js
auth.auth(req, res, next);
```

Attempt all methods of HTTP authentication. This is an express middleware function, so if authentication succeeds control will be passed to the `next` continuation function.

#### `auth_basic`

```js
client = auth.auth_basic(creds);
```

Accepts the base64 string from a Basic auth header. Returns the client principal name on success. Throws on failure.

#### `auth_gssapi`

```js
client = auth.auth_gssapi(creds, res);
```

Attempts GSSAPI authentication. The credentials should be the base64 string passed in the Negotiate auth header. The `res` parameter is the express response object, as we need to set a header.

HTTP Negotiate auth is complex and the full form breaks HTTP semantics by requiring multiple linked requests and responses. This method will only accept a Kerberos GSSAPI token; SPNEGO or any other attempt at multi-step auth will be rejected.

Returns the client principal name on success, and calls the `res.header` method to set the return token. Throws on failure.

#### `auth_bearer`

```js
client = auth.auth_bearer(creds);
```

The credentials should be the string included in a Bearer auth header. Looks up the token in the internal list and checks it hasn't expired. Returns the client principal name on success. Throws on failure.

#### `setup`

```js
auth.setup(app);
```

Set up the given Express application to use this object for authentication and to accept POST requests to `/token` which return a new token.

#### `token`

```js
auth.token(req, res);
```

This is an express request handler and should be bound to POST requests on `/token` to conform to the service spec. Generates a new random token with an appropriate expiry date, and sends a JSON object `{ token, expiry }` to supply the token to the client.

Note that the list of valid tokens only exists in memory so if the service is restarted all tokens will be invalidated.

## Web API

The `WebAPI` class implements a complete Web API backend.

### Constructor

```js
const webapi = await new WebAPI({...}).init();
```

Build a new web API object. This constructs an express application internally and configures it appropriately. Before using the object be sure to call and await the `init` method to finish setup.

| Option    | Required? | Meaning                            |
|-----------|-----------|------------------------------------|
| `max_age` | no        | Set cache control header.          |
| `ping`    | yes       | Response to `/ping`.               |
| `port`    | no        | HTTP port to bind to. (default 80) |
| `routes`  | yes       | Function to set up routes.         |

### Methods

#### `init`

```js
await webapi.init();
```

This performs the following actions:

*   The express app will be configured to parse JSON request bodies where these have an appropriate content type.
*   CORS requests will be accepted, including requests with credentials, allowing the service to be used from a browser application. 
*   If `VERBOSE` is set in the environment all requests will be logged.
*   Authentication will be configured as above.
*   A `/ping` endpoint will be created, returning the value given.
*   If `max_age` is passed, then all responses will include a Cache-Control header with `max-age` and `must-revalidate` (to allow caching authenticated responses).
*   The `routes` function will be called, with the express app as parameter, to set up user routes.

Returns the web API object.

#### `ping`
    
```js
webapi.ping(req, res);
```

Express request handler for the `/ping` endpoint.

#### `run`

```js
webapi.run();
```

Start the API listening.
