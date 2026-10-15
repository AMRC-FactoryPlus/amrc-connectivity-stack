# edge-ftp: ACS FTP driver

An Edge Agent driver for file servers that speak FTP, FTPS or SFTP. It
reads files and directory listings when the Edge Agent polls, and
writes, deletes and renames files when it is sent a command. Typical
uses are a robot controller that takes programs over FTP, and a folder
where another system drops files.

The driver hands the Edge Agent bytes for each address, as every
driver does. Set the device's payload format to **JSON** and pick values
out with each metric's JSONPath. The only exception is `file:` on a
file that isn't JSON.

## Connection

| Setting | |
|---|---|
| Protocol | `ftp` (unencrypted, password included), `ftps` (port 21 upgraded to TLS), `ftps-implicit` (TLS from the start, usually port 990) or `sftp` (over SSH). |
| Hostname/IP, Port | The port defaults to 21, 990 for implicit FTPS, or 22 for SFTP. |
| Username, Password | Leave the username empty for anonymous FTP. SFTP needs one. Password login only. |
| Server fingerprint | The SHA-256 fingerprint of the server's TLS certificate or SSH host key. |
| Write through a temporary file | On by default. See [Writes](#writes). |

**Fingerprints.** With a fingerprint, an FTPS certificate is trusted if
it matches, even if it is self-signed, which is how most devices'
certificates have to be trusted. Without one, the certificate must pass
the usual CA and hostname checks. An SFTP server is only trusted if its
host key matches; there is no CA for SSH keys. Both the `AB:CD:...`
form (openssl, browsers) and the `SHA256:...` form (ssh-keygen) work.

When a server is refused, the driver logs what it presented:

    127.0.0.1 presented ssh-ed25519 host key SHA256:iepW...coo. If that
    is the right server, put that fingerprint in the connection's
    fingerprint setting.

Check it against the server before using it, for example with
`ssh-keyscan -p 22 host | ssh-keygen -lf -`, or
`openssl s_client -connect host:21 -starttls ftp | openssl x509 -noout -fingerprint -sha256`.

The driver reports `AUTH` when the server refuses the login, and
`CONN` when it can't connect or doesn't trust the server.

## Reading

The path is everything after the first colon, so a device prefix such
as `md:` is kept.

| Address | Value |
|---|---|
| `file:<path>` | The file, unchanged. |
| `text:<path>` | `{ "path", "content" }`, with the file as text. |
| `stat:<path>` | `{ "path", "exists", "type", "size", "modified" }`. `type` is `file`, `dir`, `link` or `other`. |
| `list:<dir>` | `{ "path", "exists", "count", "entries" }`, each entry `{ "name", "type", "size", "modified" }`, sorted by name. |
| `latest:<dir>/<glob>` | The newest file in `<dir>` whose name matches the glob, as `{ "path", "name", "size", "modified", "content" }`. |

For example, with `/status/cell3.json` holding
`{"state": "RUNNING", "parts": 1423}`:

| Metric | Type | Address | Path |
|---|---|---|---|
| `Cell3/State` | String | `file:/status/cell3.json` | `$.state` |
| `Cell3/Parts` | UInt32 | `file:/status/cell3.json` | `$.parts` |
| `Programs/Pick_Size` | UInt32 | `stat:/programs/PICK.TP` | `$.size` |
| `Drop/Latest_Name` | String | `latest:/drop/*.csv` | `$.name` |

Metrics that share an address share one read per poll.

Things to know:

- **A read is limited to 1 MiB.** A file becomes a single metric value,
  so anything near that is already too big to be useful.
- **A missing file publishes nothing** for `file:`, `text:` and
  `latest:`, so their metrics keep their last value. `stat:` and
  `list:` report `exists: false`.
- **`latest:` waits for a file to stop changing.** A file only counts
  once its size and time are the same on two polls in a row, so one
  still being uploaded is not read half-written. Globs use `*` and `?`
  only. While nothing matches, nothing is published.
- **Times.** `modified` is an ISO time, or null if the server can't
  give one. Over FTP, listings only have times from servers with MLSD;
  otherwise the driver asks for each file's time (MDTM) where it needs
  one.
- **A poll has 30 seconds** to read every address in it. Keep the number
  of large reads per device small.

## Commands

A command is a write to a String metric whose address is one of these.
The value is a JSON object.

| Address | Value |
|---|---|
| `cmd:write` | `{ "path", "content" }` writes text, or `{ "path", "file" }` writes a file from the Files service by UUID. |
| `cmd:delete` | `{ "path" }` |
| `cmd:rename` | `{ "from", "to" }`. Use it to move a dropped file into a `processed/` folder. |
| `cmd:result` | Read-only: the outcome of the last command. |

Any command can carry an `"id"`, which comes back in the result, so a
caller can match a result to its write. Commands run one at a time, in
the order they arrive.

The command addresses don't contain the remote path because they can't:
the Edge Agent sends a write to the driver on an MQTT topic built from
the address, and only the part before the first `/` survives.

### Results

The Edge Agent reports a command as sent once it has passed it to the
driver, so the only way to know whether it worked is `cmd:result`:

```json
{ "id": "job-17", "command": "write", "path": "/programs/PICK.TP",
  "from": "", "to": "", "file": "0e3f4b1c-…", "size": 20480,
  "ok": true, "error": "", "at": "2026-10-14T09:31:02.118Z" }
```

Every field is always present, empty where it doesn't apply, so a
metric reading one is cleared by the next command rather than left
with an old value. Read it with metrics such as `$.ok` (Boolean),
`$.error` (String), `$.id` (String) and `$.at` (DateTime).

### Who can send commands

Commands go through Command Escalation. The driver registers two
permissions, whose command definitions list the metric names
`File_Commands/Write`, `File_Commands/Delete` and `File_Commands/Rename`
(all String):

- **Write files over FTP**: `File_Commands/Write`.
- **Delete and rename files over FTP**: `File_Commands/Delete` and
  `File_Commands/Rename`.

So give the device a `File_Commands` folder with `Write`, `Delete` and
`Rename` metrics on the `cmd:*` addresses, and grant the permissions to
the principals that should use them, per device.

### Writes

With **Write through a temporary file** on, a write uploads to
`.<name>.<random>.part` in the same directory and renames it into
place, so nothing reading the directory sees a half-written file. If
the server won't rename over an existing file, the driver deletes the
old one first. Turn this off for servers that refuse unexpected file
names or can't rename, as some robot controllers do. The driver then
writes straight to the path.

A write from the Files service is fetched by the Edge Agent, because
the driver has no Factory+ credentials of its own. The driver asks for
the file on `req/file` and the agent replies on `rsp/file`. The agent
fetches with its own identity, and its role can only download members
of the **Edge delivery file** class. So to deliver a file, upload it to
the Files service, make it a member of that class, and send its UUID.
The agent refuses files over 10 MiB by default; see `driverFileLimit` in
the edge-agent chart.

## Development

```sh
npm install
npm test
```

`test/servers.js` runs the FTP and SFTP code against real servers. It
is skipped unless `EDGE_FTP_TEST_SERVERS` is set. The servers are built
from Alpine packages and listen on localhost only:

```sh
docker build -t edge-ftp-testservers test/servers
docker run -d --rm --name edge-ftp-testservers --network host edge-ftp-testservers
EDGE_FTP_TEST_SERVERS=1 node --test test/servers.js
```
