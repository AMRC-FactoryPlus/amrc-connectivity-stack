# TODO list for edge-split work

- [ ] `DeviceConnection.readMetrics` accepts payload format / delimiter
  arguments. I don't think any of the drivers use them? This belongs
  EA-side.

- [ ] `writeMetrics` also accepts format/delimiter. I'm not clear yet
  that it isn't used for this code path. Ideally we want all device
  writes to accept a plain Buffer as might be provided from a read.

- [ ] More generally, the Connections shouldn't see the Metrics at all.
  They should operate entirely on addresses.
