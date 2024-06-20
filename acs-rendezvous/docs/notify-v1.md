# General change-notify API

Several services provide change-notify. This is a general interface to
supplement/replace the existing `Last_Changed` MQTT interface, which is
limited and causing a number of problems.

These endpoints are all namespaced under `/notify/v1`. The `/notify`
path prefix is hereby added to the core Factory+ Service spec as a
reserved namespace for standard change-notify APIs. The `/notify/v1`
prefix is reserved for the API in this document, and any future
forward-compatible extensions.

The core service spec is also hereby extended to reserve all top-level
paths not matching `/^v[0-9]/` for future extensions to the core spec.
The existing Auth service APIs are an exception (and need changing).

Note that although requests paths are written with a leading slash for
familiarity, in principle the F+ service spec allows a service API to be
rooted at a path down from the root of an HTTP server.

## Discovery

No general mechanism is defined for clients to discover that a
particular service supports this interface. Individual service
specifications will need to handle this, including (where necessary)
specifying which versions of the service spec are applicable.

In practice, the `/notify/v1` path prefix is now reserved by the F+
service spec, and so may not be used by an F+ service for any other
purpose. This means that a speculative call to `/notify/v1/listener`
should either do the right thing or return 404.

## HTTP interface

    POST /notify/v1/listener

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

    POST /notify/v1/listener/:device/channel

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

    PUT /notify/v1/listener/:device/channel/:channel

Update the channel definition. Request and response are as for the
POST above. The metric folder in the response may be different from
before. The service may refuse a change request by returning 409.

    DELETE /notify/v1/listener/:device/channel/:channel

Removes a channel from the listener. The metric folder might not be
removed if it was shared with other channels.

## Sparkplug interface

A listener is a Sparkplug Device under the service's Node containing
Sparkplug metrics. A listener always uses the `Schema_UUID`
_Listener_ (`97498ef5-bc8f-42a9-b8e5-32f729650313`). This has the following
metric structure:

* `Channels` (Folder)

The change-notify metrics will appear in folders under here.

* `Expiry` (DateTime)

The listener may be deleted on or after this date if not refreshed. This
is to ensure clients don't disappear without clearing up after
themselves. Any valid CMD, including a rebirth request to the Device,
but not including a rebirth triggered by an NBIRTH, will reset the
expiry date to some point in the future.

* `Refresh` (Boolean)

This is always published as False. A CMD to set it to True will reset
the expiry date without any other side-effect.

All metrics published by a listener should have `is_transient` set to
True. A record of the notifications is not useful without a
corresponding record of the data behind them.
