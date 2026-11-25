# py-edge-driver

## A Python library for creating Factory+ Edge Agent drivers.

This is an attempt at a straight port of the [ACS JavaScript edge driver library](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack/tree/main/lib/js-edge-driver). Refer to it for concepts and more comprehensive docs.

## Adding scouting

A driver can list the addresses its device offers, so an operator can
pick them in the Admin UI instead of typing them. This is Edge Scout.
The protocol is the "Scouting" section of `acs-edge/docs/edge-split.md`,
and `lib/js-edge-driver/docs/driver.md` describes the same interface in
JavaScript. The library does all of the protocol except producing
items: the subscription, the hello, `seq`, batching, the limits, the
time limit, cancel and errors.

Set `scouts = True` on the handler class and implement `scout`:

```python
from amrc.factoryplus.edge_driver import Handler, ScoutEnd, ScoutError

class MyHandler(Handler):
    scouts = True

    async def scout(self, request, out):
        if request.root is not None and not self.has_node(request.root):
            raise ScoutError("OPTIONS", f"Root {request.root} does not exist")

        for node in self.browse(request.root):
            if out.cancelled.is_set():
                break
            await out.add({
                "id": node.id, "parent": node.parent, "name": node.name,
                "kind": "value", "address": node.address, "type": "Double",
            })
            out.progress(visited=node.count)
            await out.pace()

        return ScoutEnd(exhaustive=True)
```

Without `scouts = True` the driver answers every scan with
`UNSUPPORTED`. The answer comes from the class, so a driver whose
configuration failed still answers correctly.

`request` is a `ScoutRequest` with `root`, `folder_id`, `options` and
`limits` (`items`, `depth`, `seconds`, `pace_ms` and `samples`). For a
branch scan the first item must have `id` equal to `folder_id`. An
item's `id` must come from the device alone, never from the scan's
root, so a node has the same `id` in a full scan and in a branch scan.

`out` is a `ScoutSink`:

* `await out.add(items)` queues one item or a list of them, and waits
  while batches go out. It raises `ScoutStopped` once the scan has
  stopped.
* `out.progress(visited=..., note=...)` records how far the scan has
  got. The library sends progress at least every 5 s.
* `await out.pace()` waits `limits["pace_ms"]`. Call it between
  southbound requests.
* `out.cancelled` is an `asyncio.Event` that is set when the scan
  stops: on cancel, on a new configuration, at the item cap or at the
  time limit.

Return a `ScoutEnd`, a dict with the same keys, or `None`. Raise
`ScoutError("OPTIONS" | "CONN" | "AUTH", message)` to fail the scan with
that code. Anything else raised ends the scan with `ERR`.

The library keeps to the limits itself as well. At the item cap `add`
raises and the scan ends truncated with reason `items`. Items deeper
than `limits["depth"]` are dropped and the scan ends truncated with
reason `depth`. At `limits["seconds"]` the scan ends truncated with
reason `seconds`, and a handler that has not returned 2 s after the
scan stopped is cancelled.

## Adding live values

The Edge Scout panel can show the current value of the addresses on
screen, read every 5 s while an operator has live values turned on.
The protocol is the "Values" section of
`docs/architecture/edge-management/edge-scout.md`. It is separate from
scouting, so a driver can read values without scanning, or scan
without reading.

Set `reads = True` on the handler class and implement `read_values`:

```python
from amrc.factoryplus.edge_driver import Handler, ReadValue, ScoutError

class MyHandler(Handler):
    reads = True

    async def read_values(self, addresses):
        if not self.session.connected:
            raise ScoutError("CONN", "The PLC is not answering")
        out = []
        for address in addresses:
            try:
                v = await self.session.read(address)
                out.append(ReadValue(address, v.value, "Double", v.source_ms))
            except LookupError as e:
                out.append(ReadValue(address, error=str(e)))
        return out
```

`addresses` holds 1 to 40 addresses in the driver's canonical form.
Return one `ReadValue`, or a dict with the keys `address`, `value`,
`type`, `ts` and `error`, for each one. `type` is a Sparkplug type name
or `None`, `ts` is the source timestamp in ms since the epoch (or a
`datetime`) or `None`, and `error` is a short reason for an address
that can't be read.

`value` can be any value, because the library writes it as text: a
string as it is, a number or a boolean as JSON writes it (`1450.5`,
`true`), bytes decoded as UTF-8, and anything else as JSON. The text is
cut at 1024 characters and an error at 256.

Read on the connection the handler already has. Never open a session,
a subscription or a client for each read. Reads run beside a running
scan, and only while the driver is `UP`.

The library answers the read for you when the handler can't:

* `UNSUPPORTED` when the handler class does not set `reads = True`.
* `CONN` when the driver is not `UP` or has no working configuration,
  or when `read_values` raises `ScoutError("CONN", ...)`.
* `ERR` when `read_values` raises anything else or does not return a
  list.

A `read_values` that has not returned in 4 s is cancelled and the
library sends nothing, so the Edge Agent records a timeout for that
round. The library drops entries for addresses it did not ask for, and
adds an error entry for any address the handler left out.

## Tests

```sh
poetry install --with test
poetry run pytest
```

`tests/test_scout_mosquitto.py` runs mosquitto in Docker and is skipped
without Docker, unless `SCOUT_MOSQUITTO=1` is set.
