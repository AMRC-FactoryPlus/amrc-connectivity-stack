# Factory+ service client

```js
import { ServiceClient } from "@amrc-factoryplus/utilities";
```

This class provides support for the process of consuming Factory+ services as a client.

All methods (should) use a Debug object for logging, allowing logging to be configured via the `VERBOSE` environment variable.

In order to successfully use GSSAPI authentication (required, for now) the environment variable `KRB5CCNAME` must be set to point to a Kerberos `ccache` containing a valid TGT we can use to fetch service tickets. The Docker images contain [a utility called `k5start`](https://www.eyrie.org/~eagle/software/kstart/) which can be useful to obtain a TGT and keep it up to date.

## Constructor

```js
fplus = await new ServiceClient({...}).init();
```

Build a new service client. Before using the object, call and await the `init` method to complete setup. Options to the constructor (all are optional, though some interfaces require certain options) are:

| Option             | Meaning                                               |
|--------------------|-------------------------------------------------------|
| `root_principal`   | Kerberos principal which overrides permission checks. |
| `permission_group` | Permission group for ACL checks.                      |
| `directory_url`    | URL to the Directory.                                 |
| `username`         | Optional Username for Basic Authentication.           |
| `password`         | Optional Password for Basic Authentication.           |


```js
await fplus.init();
```

Completes setup of the client object. Returns the client object.

## Service discovery

Service discovery starts with the URL of the Directory as supplied to the constructor. This URL forms a trust root; the Directory will be contacted over HTTP at the URL given, its identity verified by GSSAPI (and perhaps TLS), and the URLs returned trusted to provide the services they are listed for.

### `service_url`

```js
url = await fplus.service_url(service);
```

Returns the first URL from `service_urls`, or `undefined`. Should be considered deprecated, as services may have multiple URLs and this method cannot perform liveness testing.

### `service_urls`

```js
urls = await fplus.service_urls(service);
```

Accepts a service function UUID. Returns a list of URLs to potential providers of that service. These should be tried in order until one can be successfully contacted.

### `set_service_discovery`

```js
fplus.set_service_discovery(locator);
```

Install a function used to locate service URLs instead of querying the Directory. Used internally by the Directory.

### `set_service_url`

```js
fplus.set_service_url(service, url);
```

Preset a URL for the given service.

## Service HTTP requests

### `fetch`

```js
response = await fplus.fetch({ service, url, ...opts });
```

Discover a HTTP URL for a service and make a HTTP request. Responses will be properly cached according to the headers returned by the server. By default, this will perform a GSSAPI fetch for a token, if necessary, and cache tokens for later requests to the same service. The service will perform a Basic Authentication instead if ServiceClient is supplied with credentials.

Returns a Response object according to the Fetch spec. In the case of an error fetching a URL or a token the `status` property of the response will be 0.

Accepts all options acceptable to `fetch`. Also accepts and requires:

| Option    | Meaning                                              |
|-----------|------------------------------------------------------|
| `service` | The UUID of the service to contact.                  |
| `url`     | The URL, relative to the service URL from discovery. |

## Authentication service

The Authentication service interface uses the `root_principal` and `permission_group` parameters to the constructor. The first specifies a Kerberos principal name that will override all ACL checks; if an ACL check is made for that principal then it will always return success. The second specifies the UUID of the permission group to request when fetching ACLs from the Auth service; see the service documentation for more details.

### `check_acl`

```js
ok = await fplus.check_acl(principal, permission, target, wild);
```

Checks if the given principal has the given permission on the given target. Fetches permissions for the `permission_group` specified to the constructor, so the requested permission must be in that group.

The principal is specified either as a string containing a Kerberos principal name (for backwards compatability), or as an object containing a single property, `kerberos` or `uuid`, with a value as appropriate. (More principal types may be accepted in the future.) The permission and target are UUIDs.

The `wild` parameter is an optional boolean. If true, then a null UUID in the target of an ACE will be treated as a wildcard matching any target. Note: the null UUID must be in the target of the ACE in the auth database, not in the `target` parameter passed to the method. If false or unspecified the target must match exactly.

### `fetch_acl`

```js
check = await fplus.fetch_acl(principal, group);
```

Fetches the ACL for the given principal and permission group and returns a function to check a permission for a particular target. The principal is specified as above. The returned function is used as follows, where the parameters are as above.

```js
ok = check(permission, target, wild);
```

### `resolve_principal`

```js
uuid = fplus.resolve_principal(query);
```

Locate a principal and return its UUID. The query must currently be an object with a single key `kerberos` to search for a principal by Kerberos principal name, but this may be extended in future to support other principal identifiers. Returns `null` if the principal is not found.

## ConfigDB service

### `fetch_configdb`

```js
json = await fplus.fetch_configdb(app, obj);
```

Fetch an entry from the ConfigDB. The parameters are the UUIDs of the application and object for the entry to fetch. Returns the config entry parsed from JSON, or `undefined`.

## MQTT service

MQTT 5 supports extended authentication mechanisms, but no mechanisms have been defined on the standards track. Factory+ defines a mechanism supporting GSSAPI authentication, as follows:

* The authentication method is `GSSAPI`.
* The client shall call `GSS_Init_sec_context` with a NULL `input_token` and send the resulting `output_token` as authentication data in the CONNECT packet.
* The server shall call `GSS_Accept_sec_context` with the received token and:
  * If the context indicates authentication failure, optionally send a CONNACK with Reason Code indicating failure and close the connection.
  * If the context is now complete, send the final token back as the authentication data in a CONNACK packet indicating success.
  * If the context is not complete, send the output token back in an AUTH packet with Reason Code 24 (Continue Authentication).
* The client shall pass the received token to `GSS_Init_sec_context` with the same context as before. Then:
  * If the context indicates authentication failure, optionally send an appropriate DISCONNECT and close the connection.
  * If the server sent a CONNACK, and the client context is now complete, authentication is successful.
  * If the server sent a CONNACK, and the client context is not now complete, authentication has failed. Optionally send DISCONNECT and close the connection.
  * If the server sent an AUTH, the client shall send the output token in an AUTH packet with Reason Code 24.
* Client and server shall keep sending AUTH packets until the server receives a complete context and sends CONNACK, or until authentication fails.

The Factory+ implementation of this currently only accepts Kerberos GSSAPI tokens and expects a single-round exchange with no AUTH packets. The service identifier for an MQTT service principal should be `mqtt`.

### `mqtt_client`

```js
mqtt = await fplus.mqtt_client(opts);
```

The MQTT service opens a connection using GSSAPI authentication, or uses `Basic Authentication` if `ServiceClient` is supplied with credentials. The service can be supplied with an endpoint under `otps.host`, or it will attempt to perform service discovery for a MQTT broker. The options are [as documented for the `mqtt` npm module](https://www.npmjs.com/package/mqtt) except where they are overridden to support GSSAPI auth. The protocol version will always be MQTT 5.

The returned object is a Client object from the `mqtt` module, but the `connect` event is required to complete the authentication exchange. Do not add additional handlers to this event; instead use the `authenticated` event, which will only fire once authentication is successfully completed. This event will also be passed the `CONNACK` message, should you need it.

Returns `null` if discovery fails. Set an explicit service URL for `UUIDs.Service.MQTT` if you don't want discovery via the Directory.
