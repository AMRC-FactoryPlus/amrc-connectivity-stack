# Standard change-notify API

This interface provides a means for a client of a Factory+ HTTP service
to be kept up to date with changes in information held by that service.
This is a general interface to replace the existing `Last_Changed`
Sparkplug interface, which is limited, wasteful and causing a number of
problems.

The set of notifications a given principal is authorised to request is
very specific to that principal. This means that, in practice, most
notifications will have only a single consumer. For this reason, and to
avoid the issues surrounding dynamic MQTT ACLs, this interface operates
over a WebSocket provided by the service, and does not involve Sparkplug
traffic.

## Namespacing

The HTTP endpoints here are all namespaced under `notify/v2`.

The core Factory+ Service spec is hereby extended to reserve all
top-level paths not matching `/^v[0-9]` for future extensions to the
core spec. Service APIs must always be defined under a version number
prefix. The existing Auth service APIs are recognised as an exception
(and need replacing).

The top-level prefix `notify/` is reserved for standard change-notify
APIs. The prefix `notify/v2` is reserved for the API defined in this
document, or future compatible extensions.

For the avoidance of doubt, the path component of a WebSocket request
must follow the same rules as any other HTTP request.

## Version History

The original F+ service spec defined a Sparkplug interface for
change-notify using a dedicated folder of metrics published by the
service's Node. This interface is now considered to be version 0. The
structure of the change-notify metrics and their relationship to the
HTTP endpoints was not defined at the core level, and there was no way
to restrict the visibility of notifications to authorised or interested
principals.

Version 1, using HTTP endpoints under `notify/v1`, was experimentally
defined as part of the dynamic deployment work in 2024. This API also
published changes over Sparkplug, but used Devices under the Service
Node created dynamically for each consumer. An HTTP API provided
facilities for client to subscribe to sets of notifications they were
interested in. This solved some of the problems with version 0 but
required support for dynamic MQTT ACLs.

This document defined version 2, under `notify/v2`. This API publishes
changes over a WebSocket opened by the client. Change notifications
include the content of the resource which has changed, avoiding extra
GET requests and preventing race conditions.

## WebSocket interface

The client requests change-notify service by opening a WebSocket using
the path `notify/v2`, resolved under the service's URL prefix as usual,
and translated to the `ws`/`wss` scheme if required by the library in
use. No sub-protocol should be requested in the WebSocket negotiation.

Despite WebSockets being designed to be compatible with HTTP, the
WebSocket client interface provided by the browser does not support any
options to set the HTTP headers required for authentication. So the
initial exchange must be an authentication exchange, as detailed in the
next section. All subsequent messages exchanged over this WebSocket must
use text frames and contain JSON data. Message boundaries are
significant; each message must contain a single JSON value. Messages
sent by the client are subscription requests; messages sent by the
server are updates.

For each open WebSocket the server maintains a list of subscriptions.
Each subscription maps to a request to the service's plain HTTP API, and
has the effect of producing a response from the server whenever the
resource identified by the subscription has changed. The client could
achieve the same result by polling the HTTP endpoint and ignoring
identical responses; for this reason only idempotent HTTP requests may
be the subjects of subscriptions.

The client is responsible for remembering its own list of subscriptions;
the server will not report this information. If the WebSocket is closed
for any reason (including network problems) the list of subscriptions is
dropped. The client must resubscribe as needed once it has reconnected.

### Authentication

The first message sent by the client must be a text message containing
the string `Bearer ` followed by a valid bearer token for the service
being contacted. The string `Bearer` is case-sensitive and followed by
exactly one space before the bearer token. The message must end
immediately after the token with no following whitespace or newline. The
client must not send any more messages until it has received a
successful response.

The service must respond with a text message exactly three characters
long containing an HTTP status code. The code must be one of these:

Code | Meaning
---|---
200 | Successful response
400 | The service did not understand the client's first message
401 | The token is not valid
403 | The client is not permitted to use the notify interface at all
404 | This interface is not available
503 | This interface is temporarily unavailable

Some of these codes are liable to be returned as part of the WebSocket
exchange instead.

### Requests

A subscription request sent by the client manipulates its current set of
subscriptions. Each subscription is identified (within this WebSocket
connection) by a UUID coined by the client. The client is responsible
for ensuring uniqueness of these across the life of the connection.

A subscription request must be a JSON object with the following keys:

* `uuid`: The UUID of the subscription the client is changing.
* `method`: Either `WATCH` or `CLOSE`.
* `request` (optional): A description of an HTTP request as defined below.

The method `WATCH` creates a new subscription to the given HTTP
request. The UUID of the subscription must be unique and may not be
reused. If the subscription is successful the server will send at least
one update equivalent to the response that a plain HTTP request would
have received. A new update will be sent every time a repeat of the
request would have given a different response.

Note that HTTP-level errors do not cancel the subscription; the initial
response to a successful subscription may be a 403, but this may change
later and a 200 response may be returned.

The method `CLOSE` removes an existing subscription. The service may
send one or more updates that have already been queued. The service must
then send an update closing the subscription. The client must not reuse
the UUID of a closed subscription for a new subscription on the same
connection.

Other request methods may be defined in the future.

A `WATCH` request must describe the HTTP request which is the subject of
the subscription. The `request` key must be an object with these keys:

* `url`: The URL we are requesting to watch. This is interpreted
  relative to the service base URL and may include a query string.
* `method` (optional): The HTTP method of the request. This is
  case-insensitive. Defaults to `GET`.
* `headers` (optional): HTTP headers that would have been included with
  a plain HTTP request. This may be specified as an object or as an
  array; these are interpreted as in the Fetch specification.
* `body` (optional): A value which would have been encoded to JSON and
  used as the request body.

The `method`, `headers` and `body` keys will not normally be required or
valid, as only idempotent requests are permitted. Note that it is only
possible to submit a JSON request body.

### Responses

A subscription response from the service identifies the current state of
the subscription and may also return a new HTTP response to the client.
The service's idea of the state of the subscription is authoritative;
the service may close an open subscription at any time.

A subscription update must be a JSON object with these keys:

* `uuid`: The UUID of the subscription this update refers to.
* `status`: The status of the subscription. See below.
* `response` (optional): An HTTP response update.

The `status` here refers to the status of the subscription; it is
important not to confuse this with the status included in an HTTP
response update. The status code broadly follows HTTP conventions; a
`2xx` code indicates the subscription is active, and a `4xx` or `5xx`
code indicates the subscription is closed. The semantics of `1xx` and
`3xx` codes are not defined. The following status codes are valid:

Status | Meaning
---|---
201 | Initial HTTP response for a newly-created subscription
200 | Subsequent HTTP response updates
400 | Client request not understood, no subscription created
403 | Client not permitted to make this subscription
404 | This request cannot be subscribed to
410 | Subscription closed in response to a client request
500 | Subscription closed due to a service error
503 | The service is closing this subscription unilaterally

Other status codes should not be used but clients must interpret them
according to their first-digit semantics. A client receiving a `1xx` or
`3xx` status it does not understand must close the WebSocket connection.

A 201 or 200 update must include a `response` key. The value of this key
must be a JSON object describing an HTTP response, with these keys:

* `status`: The HTTP status code.
* `headers` (optional): An object or array containing headers.
* `body` (optional): The JSON value of the response body.

The `headers` and `body` keys are interpreted as for the request object
above. Note that this means that only JSON bodies can be returned via
this interface. Only headers the service considers to be semantically
significant will be included; in particular, Cache-Control will not
normally be included, and Content-Type should be considered to default
to `application/json` if not supplied.
