# General change-notify API

Several services provide change-notify. This is a general interface to
supplement/replace the existing `Last_Changed` MQTT interface, which is
limited, wasteful and causing a number of problems.

These endpoints are all namespaced under `/notify/v1`. The `/notify`
path prefix is hereby added to the core Factory+ Service spec as a
reserved namespace for standard change-notify APIs. The `/notify/v1`
prefix is reserved for the API in this document, and any future
forward-compatible extensions.

The core service spec is also hereby extended to reserve all top-level
paths not matching `/^v[0-9]/` for future extensions to the core spec.
The existing Auth service APIs are an exception (and need changing).

Note that although request paths are written with a leading slash for
familiarity, in principle the F+ service spec allows a service API to be
rooted at a path down from the root of an HTTP server, in which case the
service URLs must be resolved as e.g. `notify/v1/listener` relative to
the service base URL.

## Discovery

The `/notify/v1` path prefix is now reserved by the F+ service spec, and
so may not be used by an F+ service for any other purpose. This means
that a speculative call to `/notify/v1/listener` should either do the
right thing or return 404. Supported channels can be discovered by
attempting to create them.

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

Create a change-notify channel on the given Device. This will probably
cause the Device to rebirth with a new metric supporting the new
channel.

The request body specifies the type of change-notify channel requested,
and should be an object with these properties:

Property|Meaning
---|---
`url`|The URL (relative to the service base URL) to watch
`children`|Whether to watch all child URLs

The URL should be given as a URL relative to the service base URL. In
particular, it should **not** start with a leading slash.

A request with `children: false` is a request to watch for changes to a
single URL. A value will be published to the channel every time the
content of the URL changes. This value may be the new content of the
URL, or it may be something else. The service spec may specify this for
particular endpoints.

A request with `children: true` is a request to watch all URLs
immediately under the given URL, which should have a trailing slash. The
value published to the metric is resolved relative to the requested URL
to obtain the URL whose value has changed.

In normal usage, the URL requested, e.g. `v1/example/`, supports GET
requests and returns a list of UUIDs (of 'examples'). Then, for each
UUID, `v1/example/:uuid` also supports GET and returns JSON to a
consistent schema (a particular example). In this case, the metric will
be UUID-typed, and every time an example changes, or is created or
deleted, the example UUID will be published to the channel.

The response body gives the information needed about the new channel, as
follows:

Property|Meaning
---|---
`uuid`|A UUID identifying this channel
`metric`|The metric for this channel

The metric may be shared with other channels at the discretion of the
service. The channel UUID is unique to this request. Usually the client
will only be sent notifications for objects they have access to, but
this is not guaranteed. 

Services will in general only support requesting channels for certain
URLs. A 422 response indicates that (this implementation of) this
service doesn't support the requested form of notification.

    DELETE /notify/v1/listener/:device/channel/:channel

Removes a channel from the listener. The metric might not be removed if
it was shared with other channels.

## Sparkplug interface

A listener is a Sparkplug Device under the service's Node containing
Sparkplug metrics. A listener always uses the `Schema_UUID`
_Listener_ (`97498ef5-bc8f-42a9-b8e5-32f729650313`). This has the following
metric structure:

* `Channels` (Folder)

The change-notify metrics will appear under here.

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
