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
* `method`: One of the method strings described below.

Further keys may be required depending on the method.

All methods except CLOSE request a new subscription. The UUID of the
subscription must be unique and may not be reused. The server will send
at least one update in response indicating the state of the
subscription; if the subscription is successful the initial update(s)
will have 201 status and give the complete current state of the
resource(s) being monitored. A new update with a 200 status will then be
sent every time the resource(s) change.

Note that HTTP-level errors do not cancel the subscription; the initial
(HTTP) response to a successful subscription may be a 403, but this may
change later and a 200 response may be returned. Note also the
difference between a 201 subscription status, indicating the start of a
new subscription, and a 201 HTTP status indicating that a new resource
has been created.

### Responses

A subscription response from the service identifies the current state of
the subscription and may also return a new HTTP response to the client.
The service's idea of the state of the subscription is authoritative;
the service may close an open subscription at any time.

A subscription update must be a JSON object with these keys:

* `uuid`: The UUID of the subscription this update refers to.
* `status`: The status of the subscription. See below.
* `response` (optional): An HTTP response update.

Further keys may be required depending on the subscription type and
status.

#### Subscription status code

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

#### HTTP response

A 201 or 200 update must include a `response` key, and may include other
keys depending on the subscription type. The value of the `response` key
must be a JSON object describing an HTTP response, with these keys:

* `status`: The HTTP status code.
* `headers` (optional): HTTP headers that would have been included with
  a plain HTTP request. This may be specified as an object or as an
  array; these are interpreted as in the Fetch specification.
* `body` (optional): A value which would have been encoded to JSON and
  used as the request body.

Note that this means that only JSON bodies can be returned via this
interface. Only headers the service considers to be semantically
significant will be included; in particular, Cache-Control will not
normally be included, and Content-Type should be considered to default
to `application/json` if not supplied.

The status code here is the status of the resource being monitored,
rather than the status of the subscription. For example, an update with
201/404 status would be an initial response indicating the monitored
resource does not exist; a later 200/201 update might indicate the
resource has been created.

The meaning of the HTTP status code is not quite identical to a
standalone HTTP response, with these differences:

* A 201 status code may be returned to indicate a resource has been
  created, even though a GET request would not normally return 201.
* A 204 status code may similarly be returned to indicate that a
  resource exists but its contents are not being returned.
* A 412 status code may be returned where a subscription is monitoring
  more than one resource, to indicate that this resource has moved out
  of the set being monitored.

Services may choose whether to return 403 responses where permission is
denied or to hide the resource from the child altogether with a 404
response. In either case a consistent strategy should be followed which
should also match the results from the HTTP API.

## Subscription methods

The request methods listed here each request a different form of
subscription. A particular service will in general only support
subscription to a subset of possible HTTP requests; unsupported
subscription requests will return subscription status 404.

Subscription method names are case-sensitive.

### CLOSE

The CLOSE method removes an existing subscription. The service may send
one or more updates that have already been queued. The service must then
send an update closing the subscription; normally this will have
subscription status 410. The client must not reuse the UUID of a closed
subscription for a new subscription on the same connection.

### WATCH

A WATCH request is equivalent to polling a single HTTP request and
waiting for the response to change. Normally this will be a GET request
to a single URL, but WATCH may also be supported to monitor the results
of a POST request where this idempotent (for example, an endpoint
supporting a complex search request), or to monitor a HEAD request where
the response bodies are not required.

The subscription request requires the key `request`, which defines the
HTTP request we are asking to monitor. This is an object with these
keys:

* `url`: The URL we are requesting to watch. This is interpreted
  relative to the service base URL and may include a query string.
* `method` (optional): The HTTP method of the request. This is
  case-sensitive and must be uppercase. Defaults to `GET`.
* `headers` (optional): An object or array containing headers.
* `body` (optional): The JSON value of the response body.

The `method`, `headers` and `body` keys will not normally be required or
valid, as only idempotent requests are permitted. These are interpreted
as for HTTP responses in updates; note that it is only possible to
submit a JSON request body. If a Content-Type header is not supplied it
must default to `application/json`.

### SEARCH

A SEARCH request monitors a set of resources rather than a single
resource. The set of resources monitored are all the immediate children
of a parent URL path, possibly with additional filtering applied. The
responses to SEARCH are always equivalent to a set of plain GETs of the
resources concerned, along with monitoring the state of the parent
resource to determine which resources exist.

For example, suppose a service supports the GET endpoint `v1/example/`,
which returns an array of UUIDs listing the currently-existing examples,
and also the endpoints `v1/example/:uuid` to retrieve the individual
example resources. A client would be able to stay up to date on the
state of all (or a subset) of these examples by polling these URLs. This
is a situation where SEARCH may be applicable; in this case the parent
URL is `v1/example/`.

A SEARCH request must contain these additional keys:

* `parent`: The parent URL to the resources to monitor. This must end
  with a slash.
* `filter` (optional): A JSON object requesting a filter on the
  resources monitored.

#### Monitoring all children

Without a filter, a SEARCH will monitor all resources immediately under
the `parent` URL. Successful updates referring to children of the parent
resource must have an additional property `child`, indicating the path of
the resource returned resource relative to the parent URL. (The parent
URL must end with a slash to make the relative URL resolution rules work
correctly.)

Updates referring to the parent resource itself must not have the `child`
property, and must not convey the contents of the parent as this will
usually just be a list of the children. Instead the 204 HTTP status code
must be used to indicate successful access to the parent. When a
subscription is successful, a 201/200 update must be sent for all
existing (and selected) children, followed by a 201/204 update for the
parent resource. This informs the client it has a complete view of the
state of the child resources.

Subsequent changes to child resources must be sent as follows:
* An updated child resource will cause a 200/200 update.
* A new child resource will cause a 200/201 update.
* A removed child resource will cause a 200/404 update.
* An ACL change to deny this client permission to a child resource will
  cause either a 200/403 or a 200/404 update.
* A change which causes a child resource to leave the filtered set will
  cause a 200/412 update.

Changes to the list of children must not be reported as updates to the
parent resource, even though the content returned from a GET request to
that resource has changed. However if the parent (or access to the
parent) is removed a 200/404 (or 200/403) update for the parent must
be sent; this implies also removal of (access to) all children.
Subsequent recreation must send a (possibly empty) set of 200/200
updates for children followed by a 200/204 update for the parent.

#### Example

For example, we have our `v1/example/` endpoints above. A subscription
request like this:

```yaml
uuid: eb546f59-26c1-4c80-b40b-992401396bfb
method: SEARCH
parent: v1/example/
```

might return these initial updates (these are displayed as a list of
YAML documents but would be returned as series of WS messages containing
the equivalent JSON):

```yaml
uuid: eb546f59-26c1-4c80-b40b-992401396bfb
status: 201
child: abc-123
response:
    status: 200
    body:
        name: abc-123
---
uuid: eb546f59-26c1-4c80-b40b-992401396bfb
status: 201
child: xyz-789
response:
    status: 200
    body:
        name: xyz-789
---
uuid: eb546f59-26c1-4c80-b40b-992401396bfb
status: 201
response:
    status: 204
```

This indicates that at the time of initial subscription the parent
resource had two children, and gives their paths and contents. The
following updates might then be received:

```yaml
# Update to an existing child
uuid: eb546f59-26c1-4c80-b40b-992401396bfb
status: 200
child: abc-123
response:
    status: 200
    body:
        name: ABC-123
---
# Creation of a new child
uuid: eb546f59-26c1-4c80-b40b-992401396bfb
status: 200
child: def-234
response:
    status: 201
    body:
        name: DEF-234
---
# Deletion of a child
uuid: eb546f59-26c1-4c80-b40b-992401396bfb
status: 200
child: def-234
response:
    status: 404
```

#### Filtering

Sometimes a client is only interested in monitoring a subset of the
child resources. In this case the client can specify a `filter`, which
is used to select the child resources to monitor, as follows ('selected'
resources match the filter, 'filtered out' resources do not):

* Existing resources which are filtered out will not be returned as part
  of the initial 201/200 updates.
* Updates to filtered-out resources which leave them filtered out will
  be ignored.
* Updates which bring an existing resource into the selected set will be
  reported with a 200/200 update.
* Updates which move an existing resource (which has already been
  reported) out of the selected set will be reported with a 200/412
  update.
* Newly-created selected resources will be reported with a 200/201
  update. Removed selected resources will be reported with 200/404.
* Creation or deletion of filtered-out resources will be ignored.

The filter is a JSON value, and is applied, as a JSON Merge Patch, to
the body of a resource. If this results in no change the resource is
selected; otherwise it is filtered out. This means

* In practice both filter and body must be JSON objects to achieve a
  useful result.
* A property can be explicitly selected for non-presence by specifying
  it as `null`.
* Selecting `null` as a value is therefore not possible.
* Arrays are treated as units; filtering on individual items in an array
  is not possible.

