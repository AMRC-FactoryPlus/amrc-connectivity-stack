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
      - device: be7c6ed7-fa1b-4f24-bc0d-b94d787c40da
        address: AMRC-F2050/Power_Monitoring/me1xxx
        metric: Dynamic/a54fe
```

The devices identified will use the `Schema_UUID` _Dynamic_ 
(`1d230cc3-4cc4-4a88-b1e5-f8a686704171`). The addresses returned are for
convenience; consumers are expected to track the device via the
Directory. The `metric` property gives the prefix of a folder containing
a `Schema_UUID` metric matching the requested schema. The
`Instance_UUID` in this folder will match that originally used by the
source device, and can therefore be used to identify a particular data
source across multiple dynamic deployment requests. Metrics not
requested will not be present. 

## Rendezvous service API

The Rendezvous service is discovered via the Directory using the Service
UUID `fa2b5b1b-d0b7-4f8d-9f26-c9560c84214b`.

The Rendezvous service supports the `/notify/v1` [standard change-notify
interface](notify-v1.md). The old `Last_Changed` interface on the
Service Node is not supported.

### Channels for the Rendezvous service

Two forms of channel are needed for the Rendezvous service: reconcilers
need a channel over which they can watch all requests they understand,
and consumers need a channel over which they can watch responses to
their requests. Both can be served by a channel request containing a
list of message types:

    types:
        - bd7d5a31-d71e-4018-b165-8935fd38687d

In both cases notifications will only be returned for messages the
client is authorised to view; consumers which are not also reconcilers
will in general only be authorised to view responses to their own
requests. If listeners are shared between multiple app instances running
under the same account, consumers will have to track which requests are
theirs and filter out unwanted responses themselves; this should not be
a problem.
