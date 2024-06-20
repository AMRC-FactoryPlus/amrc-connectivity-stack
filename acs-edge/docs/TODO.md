# TODO list for edge-split work

- [x] The Device subclasses need to go. Where they do work this needs to
  move into the Connection. In particular some Devices handle
  subscription tasks which should move to `startSubscription`.

- [ ] `DeviceConnection.readMetrics` accepts payload format / delimiter
  arguments. I don't think any of the drivers use them? This belongs
  EA-side.

- [ ] `writeMetrics` also accepts format/delimiter. I'm not clear yet
  that it isn't used for this code path. Ideally we want all device
  writes to accept a plain Buffer as might be provided from a read.

- [x] The Connection currently handles the poll loop, as part of
  `startSubscription`. 
    * For simple connections this is implemented in the base class and
      should be handled by the Device (EA-side).
    * Some Connections (MTConnect, OPCUA) can request polling in the
      southbound protocol. The driver protocol needs extending to handle
      this case.

- [ ] More generally, the Connections shouldn't see the Metrics at all.
  They should operate entirely on addresses.

- [x] Multiple Devices may subscribe to a single Connection. The EA-side
  Connection will need to track the current list of addresses we are
  interested in and push it down to the driver.

- [ ] Devices are currently linked to a single Connection. This is not
  necessary, but means we need to:
    * Add a `connection` property to each metric definition.
    * Change the Device to poll via a central connection manifold rather
      than via an individual connection.
    * Supply data topic names to a Device in return for addresses when
      it subscribes to the connection manifold.
    * Poll the manifold using connection/datatopic pairs.
