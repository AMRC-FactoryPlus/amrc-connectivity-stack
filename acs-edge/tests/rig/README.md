# Split-driver cluster rig

Mock devices shaped like a site's real connections, and the scripts that
put matching Edge Agent connections on a dev cluster, record what the
Edge Agents publish, and compare before and after the version 7
upgrade. The runbook that uses them is
[`docs/development/split-driver-cluster-test.md`](../../../docs/development/split-driver-cluster-test.md).

| File | |
|---|---|
| `rig.ts` | The rig file and `rig_entry()`, the one place a connection is pointed at its mock. |
| `make-rig.ts` | Makes a rig, its Kubernetes manifests and a coverage report from connection configs. |
| `run-mocks.ts`, `mocks/` | The mocks: OPC UA server, HTTP server, MQTT broker and publisher, UDP sender. Each replays a synthetic fixture from `../fixtures/drivers` in a loop. |
| `load.ts`, `remove.ts`, `acs.ts` | Create and delete the rig's Edge Agents, connections and devices through ConfigDB. Dry run unless `--yes`. |
| `check.ts` | Records the rig's Sparkplug output and compares two recordings, using the golden harness's decoder. |
| `write.ts` | Sends one metric write through the Command Escalation service. |
| `local.ts` | Runs part of a rig on one machine with the real `Translator` and, optionally, split drivers. |
| `examples/` | Made-up connection configs, one per protocol, in the export form `make-rig` reads. |
| `Dockerfile` | The `acs-rig-mocks` image with every command above. Build it from the repository root. |

A rig made from real connection configs names real hosts, topics and
devices. Keep the configs, the rigs and the recordings outside this
repository. Only the made-up examples belong here.

To try it with the examples:

```sh
docker build -f acs-edge/tests/rig/Dockerfile -t acs-rig-mocks:dev .
docker run --rm -v "$PWD/acs-edge/tests/rig/examples:/in:ro" -v /tmp/rig:/out acs-rig-mocks:dev make-rig /out /in
docker run --rm -v /tmp/rig:/out acs-rig-mocks:dev local --rig /out/rig.json --only opcua-1,mqtt-1,rest-1,udp-1 --seconds 60 --out /out/local.json
```
