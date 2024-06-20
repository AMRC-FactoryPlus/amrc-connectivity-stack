# Design notes for Rendezvous service

The purpose of this service is to allow consumers and reconciliation
services to communicate with each other.

Communication takes the form of requests from consumers and responses
from reconciliation services. Requests may prompt zero or more responses
appearing and disappearing over time. When a request is removed all
responses to that request are also removed.

## Example scenario

We have multiple power monitoring devices publishing to the Power
Monitoring v2 schema. We also have a consumer interesting in consuming
all the `Active_Power` metrics from these power monitors. As power
monitors come on- and offline the consumer needs to be given access to
the data.

## Message format

Requests and responses have a common format. This take the form of a
JSON object; examples in this document are given as the equivalent YAML
for clarity. Where we say 'a list is treated as a set' this means that
clients should attach no significance to the order of entries or to
duplicate entries; entries may be reordered or dedeplicated as they pass
through the API.

The outer message format contains bookkeeping information and looks like
this:

    uuid: 311d4465-042c-4462-bc81-c452ee493408
    owner: 19f79381-7ac3-4e9e-8cf6-2d50e39bf559
    type: 99ab918e-8b9e-40c7-bfff-83a3ddb9db17
    content:
      # ...

These properties are used as follows:

* `uuid`: A unique identifier for this message, assigned by the
  Rendezvous service when the message is posted.
* `owner`: The UUID of the principal which posted the message, and which
  may delete it.
* `type`: A message type UUID. Some message types are requests and some
  are responses; clients are expected to know which types they
  understand.
* `content`: The content of the message, as defined by the message type.
  The Rendezvous service does not interpret or validate this.

### Consumption requests

These are published by consumers to specify what they wish to consume.
Requests have the following format (extended from the common message
format above):

    uuid: 0fb4fd72-60dd-4b31-862f-92ae834e4e3e
    owner: 9f37238a-142b-4c12-b60c-5e760b9fcdf2
    type: bd7d5a31-d71e-4018-b165-8935fd38687d
    content:
      responseTypes:
        - 99ab918e-8b9e-40c7-bfff-83a3ddb9db17
      # ...

The additional field here is `responseTypes`, which identifies this
message as a request and gives a list of response types acceptable to
the requester. This list is treated as a set.

Currently the only consumption request type defined is _Factory+
Schema_ (`bd7d5a31-d71e-4018-b165-8935fd38687d`), which specifies

* A F+ Schema UUID to define the semantics we require.
* Metrics required from within the schema instances.

    uuid: 0fb4fd72-60dd-4b31-862f-92ae834e4e3e
    owner: 9f37238a-142b-4c12-b60c-5e760b9fcdf2
    type: bd7d5a31-d71e-4018-b165-8935fd38687d
    content:
      responseTypes:
        - 99ab918e-8b9e-40c7-bfff-83a3ddb9db17
      schema: 0ff890b0-1ddb-4cb0-96eb-b0e87039df2f
      metrics:
        - Active_Power

The list of metrics is treated as a set. Specifying a metric folder in
the `metrics` list will include all metrics under that folder.

## Reconciliation responses

These are published by reconciliation services in respose to consumption
requests. They inform consumers of data that has been made available.
Responses have the following format:

    uuid: 311d4465-042c-4462-bc81-c452ee493408
    owner: 19f79381-7ac3-4e9e-8cf6-2d50e39bf559
    type: 99ab918e-8b9e-40c7-bfff-83a3ddb9db17
    content:
      responseTo: 0fb4fd72-60dd-4b31-862f-92ae834e4e3e
      # ...

The additional field here is `responseTo`, which identifies this as a
response and gives the UUID of the request we are responding to.

Currently the only response type defined is _Factory+ Instance_ 
(`99ab918e-8b9e-40c7-bfff-83a3ddb9db17`) which contains a list of schema
instances within Sparkplug Devices publishing the information requested.

    uuid: 311d4465-042c-4462-bc81-c452ee493408
    owner: 19f79381-7ac3-4e9e-8cf6-2d50e39bf559
    type: 99ab918e-8b9e-40c7-bfff-83a3ddb9db17
    content:
      responseTo: 0fb4fd72-60dd-4b31-862f-92ae834e4e3e
      device: be7c6ed7-fa1b-4f24-bc0d-b94d787c40da
      address: AMRC-F2050/Power_Monitoring/me1xxx
      metric: Dynamic/a54fe

The devices identified will normally use the `Schema_UUID` _Dynamic_ 
(`1d230cc3-4cc4-4a88-b1e5-f8a686704171`), but this should not be relied
on as an existing Device may be returned if available. The addresses
returned are for convenience; consumers are expected to track the device
via the Directory.

The `metric` property gives the prefix of a folder containing a
`Schema_UUID` metric matching the requested schema. The `Instance_UUID`
in this folder will match that originally used by the source device, and
can therefore be used to identify a particular data source across
multiple dynamic deployment requests. Metrics not requested may or may
not be present. 

## Rendezvous service API

The Rendezvous service is discovered via the Directory using the Service
UUID `fa2b5b1b-d0b7-4f8d-9f26-c9560c84214b`.

The Rendezvous service supports the `/notify/v1` [standard change-notify
interface](notify-v1.md). The old `Last_Changed` interface on the
Service Node is not supported.

### HTTP interface

    GET /v1/message/:message

Fetch a particular message. Returns the full message structure.

    DELETE /v1/message/:message

Delete a particular message. Only the message's owner and administrators
are permitted to delete messages. Deleting a request will delete all
associated responses.

    GET /v1/message/:message/responses

Fetch a JSON list of the UUIDs of responses to this message. Returns 404
if the message given is not a request.

    GET /v1/type/:type

List messages of the given type. Returns a JSON array listing the UUIDs
of all messages of the given type the client has access to.

    POST /v1/type/:type

Create a new message of the given type.

The body of the request should be the content of the new message, i.e.
the value of the `content` property. The other top-level properties will
be assigned automatically by the Rendezvous service.

The body of the response is a JSON string containing the UUID assigned
to the new message.

This returns 422 if a response is posted to a request which does not
exist, has been deleted or does not accept responses of this type.

### Sparkplug interface

The Sparkplug interface to the Rendezvous service consists solely of
change-notify channels.

Two forms of channel are needed for the Rendezvous service: reconcilers
need a channel over which they can watch all requests they understand,
and consumers need a channel over which they can watch responses to
their requests. Both can be served by a channel request containing a
list of message types:

    types:
        - bd7d5a31-d71e-4018-b165-8935fd38687d
    reflect: false

The `reflect` property, which defaults to `false`, specifies whether
messages owned by the requesting client should be reported. Clients must
not assume that they will not be, even if `reflect` is `false`.

Since the Rendezvous service does not know which message types represent
requests and which responses, the channel metric structure is always the
same:

* `Request` (UUID): This is published when a request of one of the given
  types is created or deleted.

* `Response` (UUID): This is published when a response of one of the
  given types is created or deleted.

In both cases notifications will only be returned for messages the
client is authorised to view; consumers which are not also reconcilers
will in general only be authorised to view responses to their own
requests. If listeners are shared between multiple app instances running
under the same account, consumers will have to track which requests are
theirs and filter out unwanted responses themselves.

