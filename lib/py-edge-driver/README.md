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

## Tests

```sh
poetry install --with test
poetry run pytest
```

`tests/test_scout_mosquitto.py` runs mosquitto in Docker and is skipped
without Docker, unless `SCOUT_MOSQUITTO=1` is set.
