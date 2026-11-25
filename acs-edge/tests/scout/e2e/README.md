# Edge Scout end-to-end tests

`../e2e.test.ts` runs the Edge Agent as its own Node process with the real split drivers, and checks Edge Scout from the Sparkplug command to the stored snapshot. `.github/workflows/scout-e2e.yaml` runs it on pull requests.

| File | |
|---|---|
| `agent-main.ts`, `tsconfig.json` | The agent's entry point, as `app.ts` but without the version file the Docker build makes. It is compiled with the agent's own tsconfig into `node_modules/.cache/scout-e2e`, and it prints its memory and CPU use on `E2E-USAGE` lines. |
| `services.ts` | Auth, Directory, ConfigDB and Files over HTTP on one port, so the agent uses its real service client. It records every status write and can answer one upload with 401 to check that the agent sends the same body again. |
| `processes.ts` | Starts mosquitto, the node-opcua test server from `edge-opcua/tests/server` in its `SCOUT` mode, the agent and the drivers. |
| `sparkplug.ts` | Reads the agent's NBIRTH and DDATA from mosquitto and sends `Node Control/Scout` as an NCMD, as cmdesc does. |
| `old-agent.ts` | A stand-in for an agent of another release: the real `DriverBroker` with that release's ACL, and an `addr` with or without `features`. |
| `limit.sh` | Runs a command in a cgroup with a CPU and memory limit, for the load case. |

## What it covers

- The NBIRTH carries `Node Control/Scout`, and each driver's hello is written once.
- A full OPC UA scan with edge-opcua: the status goes queued, running, done, the snapshot is valid, the Server object is excluded, and the upload survives an expired token.
- A branch scan of an OPC UA folder, which merges back into the same snapshot.
- Three MQTT scans with edge-mqtt: the change list after topics change, and the oldest snapshot deleted from Files before ConfigDB.
- `BUSY` for a second scan, cancel, and `NOTRUNNING`, with edge-test.
- `UNSUPPORTED` from edge-test with `SCOUT_UNSUPPORTED=1`, and `LIBRARY` from a driver that never subscribes to `scout`.
- Live values from edge-test while a scan runs on the same connection: watch, the values entry, no write while values stay the same, unwatch and the empty entry, and `NOREADS` from edge-test with `SCOUT_UNSUPPORTED=1`.
- `INTERRUPTED` after the agent stops (SIGTERM) or is killed (SIGKILL) during a scan.
- Each of edge-test, edge-test-rs, edge-opcua and edge-mqtt against an older agent, this release and a rollback, never disconnected and never subscribing to `scout` where the ACL refuses it.
- The agent's size cap (`SCOUT_MAX_BYTES`) and the item cap.
- The load case: a 49,950-item edge-test-rs scan while edge-mqtt delivers a value every 50 ms. It records DDATA latency from the value's publish to its DDATA, the agent's peak memory and its CPU share, and fails when the 95th percentile latency more than doubles or memory passes 180Mi.

## Running it

It skips unless `SCOUT_E2E=1`. It then needs:

- `cargo build --release` in `edge-opcua`, `edge-mqtt` and `edge-test-rs`, or `SCOUT_E2E_OPCUA`, `SCOUT_E2E_MQTT` and `SCOUT_E2E_TEST_RS` naming the binaries
- `npm install --save=false --install-links` in `acs-edge` and `npm ci --install-links` in `edge-test`
- mosquitto on `PATH`, or `SCOUT_E2E_MOSQUITTO` naming it

The drivers are Linux binaries in CI. On a Mac, run the whole test in a Linux container that has Rust, Node 22 and mosquitto, with the drivers built inside it.

`SCOUT_E2E_AGENT_WRAP` is a command to run the agent under. For the chart's limits, give `limit.sh 100 200`, which needs root and a writable cgroup v2, so use `sudo -E LIMIT_UID=$(id -u) LIMIT_GID=$(id -g) .../limit.sh 100 200` on a CI runner, or run a container with `--privileged --cgroupns=private`.

`SCOUT_E2E_MARKER` names a file the test writes when it finishes. It lists each case as passed or missing, and its last line is `all cases passed` only when every case passed, which is what CI checks. `SCOUT_E2E_REPORT` names a JSON file for the measurements. `SCOUT_E2E_LOAD_PACE_MS` sets the load scan's `pace_ms`, which is otherwise the agent's default.
