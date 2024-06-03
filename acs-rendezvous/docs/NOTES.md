# Design notes for Rendezvous service

The purpose of this service is to allow consumers and reconciliation
services to communicate with each other.

Communication takes the form of requests from consumers and responses
from reconciliation services. Requests may prompt zero or more responses
appearing and disappearing over time.

## Example scenario

We have multiple power monitoring devices publishing to the Power
Monitoring v2 schema. We also have a consumer interesting in consuming
all the `Active_Power` metrics from these power monitors.

## Consumption requests

These are published by consumers to specify what they wish to consume.
Consumption requests need to specify the following information:

* Unique identifier for request.
* Owner of request.
* Format of request.
* Recognised formats of reconciliation responses.
* Semantics of information required. Initially this will be specified as
  a F+ Schema UUID.
* Metrics required from within the schema instances.

```
    id: 0fb4fd72-60dd-4b31-862f-92ae834e4e3e
    owner: 9f37238a-142b-4c12-b60c-5e760b9fcdf2
    type: bd7d5a31-d71e-4018-b165-8935fd38687d
    responseTypes:
      - 99ab918e-8b9e-40c7-bfff-83a3ddb9db17
    requests:
      - schema: 0ff890b0-1ddb-4cb0-96eb-b0e87039df2f
        metrics:
          - Active_Power
```

## Reconciliation responses

These are published by reconciliation services in respose to consumption
requests. They inform consumers of data that has been made available.
Responses need to contain the following information:

* Request this is a response for.
* Sparkplug Devices publishing the requested information.

```
    id: 311d4465-042c-4462-bc81-c452ee493408
    owner: 19f79381-7ac3-4e9e-8cf6-2d50e39bf559
    type: 99ab918e-8b9e-40c7-bfff-83a3ddb9db17
    responseTo: 0fb4fd72-60dd-4b31-862f-92ae834e4e3e
    devices:
      - AMRC-F2050/Power_Monitoring/0fb4fd72-60dd-4b31-862f-92ae834e4e3e
```

The assumption is that consumers can parse the schema structure of the
devices and locate the information they need.

## General change-notify API

Several services provide change-notify. This is a general interface to
replace/supplement the existing `Last_Changed` MQTT interface.

### HTTP interface

    POST /v1/listener

Clients requiring change-notify service start by creating a listener
using this endpoint. A listener is a Sparkplug Device under the
service's Node providing change-notify metrics. The requesting principal
will be granted access to the device in the Auth service.

The request body is empty. The response is an object:

Property|Meaning
---|---
`uuid`|Device UUID of the new device
`address`|Sparkplug address of the new device

A listener may be shared between multiple clients at the discretion of the
service. The address is provided as a convenience only; consumers are
expected to track the listener via the Directory.

    POST /v1/listener/:device/channel

Create a change-notify channel on the given Device. This will cause the
Device to rebirth with new metrics supporting the new channel. The new
metrics will be under a new metric folder; the contents of the folder
depend on the service and the type of channel requested.

The request body specifies the type of change-notify channel requested.
The format depends on the individual service. The response is always an
object:

Property|Meaning
---|---
`uuid`|A UUID identifying this channel
`metric`|The metric folder prefix for this channel

The metric folder may be shared with other channels at the discretion of
the service. The channel UUID is unique to this request. There may or
may not be an `Instance_UUID` metric in the channel metric folder, and
it may or may not match the channel UUID.

    PUT /v1/listener/:device/channel/:channel

Update the channel definition. Request and response are as for the
POST above. The metric folder in the response may be different from
before. The service may refuse a change request by returning 409.

    DELETE /v1/listener/:device/channel/:channel

Removes a channel from the listener. The metric folder might not be
removed if it was shared with other channels.

### Sparkplug interface

A listener is a Sparkplug Device under the service's Node containing
Sparkplug metrics. A listener always uses the `Schema_UUID`
Listener `97498ef5-bc8f-42a9-b8e5-32f729650313`. This has the following
metric structure:

    Expiry (DateTime)

The listener may be deleted on or after this date if not refreshed. This
is to ensure clients don't disappear without clearing up after
themselves. Any valid CMD, including a rebirth request, will reset the
expiry date further into the future; a CMD to set Expiry (to any value)
will also be accepted, and will reset the expiry ignoring the value in
the CMD.

    Channels (Folder)

The change-notify metrics will appear in folders under here.
