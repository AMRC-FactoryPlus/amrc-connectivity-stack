/*
 * ACS FTP driver
 * Edge Agent driver handler.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Reads files and directory listings from an FTP, FTPS or SFTP server
 * when the edge agent polls, and writes, deletes and renames files
 * when it forwards a command. The addresses are described in
 * README.md.
 */

import crypto from "crypto";

import { BufferX } from "@amrc-factoryplus/edge-driver";

import { join, parse_addr } from "./address.js";
import { FTPTransport } from "./ftp.js";
import { SFTPTransport } from "./sftp.js";
import {
    AuthError, NotFound, UntrustedServer,
    format_fingerprint, parse_fingerprint,
} from "./transport.js";

const TRANSPORTS = {
    "ftp":              FTPTransport,
    "ftps":             FTPTransport,
    "ftps-implicit":    FTPTransport,
    "sftp":             SFTPTransport,
};

/* The largest file a poll will read. A read becomes one metric value,
 * so anything near this is already far too big to be useful. */
export const MAX_READ = 1024 * 1024;

/* How long to wait for the edge agent to fetch a file from the Files
 * service. */
export const FETCH_TIMEOUT = 60000;

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Validate the connection config. Returns options for the transport,
 * or undefined (after logging why) if the config is unusable. */
export function check_conf (conf, log) {
    const fail = msg => log("Bad connection config: %s", msg);

    const protocol = conf.protocol ?? "ftp";
    if (!TRANSPORTS[protocol])
        return fail(`unknown protocol ${protocol}`);
    if (typeof conf.host != "string" || conf.host == "")
        return fail("no host");

    /* An emptied number field can come through as 0. */
    const port = conf.port == null || conf.port === "" || conf.port === 0
        ? undefined : Number(conf.port);
    if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536))
        return fail(`bad port ${conf.port}`);

    const fingerprint = conf.fingerprint
        ? parse_fingerprint(conf.fingerprint) : undefined;
    if (conf.fingerprint && !fingerprint)
        return fail("the fingerprint is not a SHA-256 fingerprint");

    if (protocol == "sftp" && !conf.username)
        return fail("SFTP needs a username");

    return {
        protocol, port, fingerprint,
        transport:  TRANSPORTS[protocol],
        host:       conf.host,
        username:   conf.username || undefined,
        password:   conf.password || undefined,
        atomic:     conf.atomicWrites ?? true,
    };
}

export class FTPHandler {
    constructor (driver, opts) {
        this.driver = driver;
        this.opts = opts;
        this.log = driver.debug.bound("ftp");

        this.remote = null;
        this.closing = false;
        /* One remote operation at a time: FTP can't run two on one
         * connection, and the library's serial poll queue doesn't cover
         * commands. */
        this.lock = Promise.resolve();
        /* Commands run one at a time, in the order they arrive. */
        this.commands = Promise.resolve();
        /* The outcome of the last command, for cmd:result. */
        this.result = null;
        /* Per latest: address, the files seen on the last poll and the
         * last value returned. */
        this.seen = new Map();
        /* The last error per address, so a persistent one is logged
         * once rather than on every poll. */
        this.errors = new Map();
        /* Files service fetches in flight, by file UUID. */
        this.fetches = new Map();
        this.fetch_timeout = FETCH_TIMEOUT;

        /* Replies from the edge agent. Handlers are keyed by the first
         * topic segment after the driver id, so this receives every
         * rsp/<what> message. */
        driver.message("rsp", (payload, data) => this.rsp(payload, data));
    }

    static create (driver, conf) {
        const opts = check_conf(conf, driver.debug.bound("ftp"));
        if (!opts) return;
        return new FTPHandler(driver, opts);
    }

    parseAddr (addr) {
        return parse_addr(addr);
    }

    async connect () {
        /* The base class only subscribes to the topics it knows about,
         * so the rsp topic is ours to add. Without it, writes from the
         * Files service time out, but everything else still works. */
        await this.driver.mqtt.subscribeAsync(this.driver.topic("rsp", "file"))
            .catch(e => this.log("Can't subscribe to rsp/file: %s", e.message));

        return this.with_lock(async () => {
            try {
                await this.open();
                return "UP";
            }
            catch (e) {
                this.connect_failed(e);
                return e instanceof AuthError ? "AUTH" : "CONN";
            }
        });
    }

    async close () {
        this.closing = true;
        for (const uuid of [...this.fetches.keys()])
            this.settle(uuid, new Error("driver closing"));
        await this.with_lock(() => this.remote?.close());
    }

    async open () {
        await this.remote?.close();
        this.remote = null;

        const remote = new this.opts.transport({ ...this.opts, log: this.log });
        try {
            await remote.connect();
        }
        catch (e) {
            await remote.close();
            throw e;
        }
        this.remote = remote;
        this.log("Connected to %s server %s", this.opts.protocol, this.opts.host);
    }

    connect_failed (e) {
        const { protocol, host } = this.opts;
        this.log("Can't connect to %s: %s", host, e.message);
        if (e instanceof UntrustedServer && e.digest) {
            const fp = format_fingerprint(e.digest,
                protocol == "sftp" ? "ssh" : "hex");
            this.log("%s presented %s %s. If that is the right server, put "
                + "that fingerprint in the connection's fingerprint setting.",
                host, e.what, fp);
        }
    }

    with_lock (fn) {
        const run = this.lock.then(fn);
        this.lock = run.catch(() => {});
        return run;
    }

    /* Run fn(remote) under the lock. Servers drop idle connections, so
     * reconnect first if ours has gone. Only if that fails does the
     * driver hear about it; it then retries connect() until it works. */
    exclusive (fn) {
        return this.with_lock(async () => {
            if (this.closing)
                throw new Error("driver closing");
            if (!this.remote || this.remote.closed) {
                try {
                    await this.open();
                }
                catch (e) {
                    this.connect_failed(e);
                    if (e instanceof AuthError)
                        this.driver.connUnauth();
                    else
                        this.driver.connFailed();
                    throw e;
                }
            }
            return fn(this.remote);
        });
    }

    async poll (spec) {
        try {
            const buf = await this.read(spec);
            this.errors.delete(spec.addr);
            return buf;
        }
        catch (e) {
            if (this.errors.get(spec.addr) != e.message)
                this.log("Can't read %s: %s", spec.addr, e.message);
            this.errors.set(spec.addr, e.message);
        }
    }

    async read (spec) {
        switch (spec.kind) {
        case "cmd":
            /* The command addresses themselves have nothing to read. */
            if (spec.verb == "result" && this.result)
                return BufferX.fromJSON(this.result);
            return;
        case "file":
            return this.exclusive(r => r.read(spec.path, MAX_READ));
        case "text": {
            const buf = await this.exclusive(r => r.read(spec.path, MAX_READ));
            return BufferX.fromJSON({ path: spec.path, content: buf.toString() });
        }
        case "stat":
            return BufferX.fromJSON(await this.stat(spec.path));
        case "list":
            return BufferX.fromJSON(await this.list(spec.path));
        case "latest":
            return this.latest(spec);
        }
    }

    /* The edge agent never publishes a null, so a metric reading a null
     * keeps its old value. Where a field has a sensible empty value,
     * use it instead. */
    async stat (path) {
        try {
            const st = await this.exclusive(r => r.stat(path));
            return { path, exists: true, ...st, size: st.size ?? 0 };
        }
        catch (e) {
            if (!(e instanceof NotFound)) throw e;
            return { path, exists: false, type: "", size: 0, modified: null };
        }
    }

    async list (dir) {
        try {
            const entries = await this.exclusive(r => r.list(dir));
            entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
            return { path: dir, exists: true, count: entries.length, entries };
        }
        catch (e) {
            if (!(e instanceof NotFound)) throw e;
            return { path: dir, exists: false, count: 0, entries: [] };
        }
    }

    /* The newest file in a directory whose name matches a glob. A file
     * only counts once its size and time have held still for a whole
     * poll interval, so one still being uploaded isn't read
     * half-written. While nothing matches, nothing is published and the
     * metric keeps its last value. */
    async latest (spec) {
        const seen = this.seen.get(spec.addr) ?? { files: new Map() };
        this.seen.set(spec.addr, seen);

        const files = await this.exclusive(async r => {
            const entries = (await r.list(spec.dir))
                .filter(e => e.type == "file" && spec.match.test(e.name));
            /* Listings from servers without MLSD have no times. */
            for (const e of entries)
                e.modified ??= await r.modified(join(spec.dir, e.name));
            return entries;
        }).catch(e => {
            if (e instanceof NotFound) return [];
            throw e;
        });

        const now = new Map(files.map(f => [f.name, `${f.size} ${f.modified}`]));
        const stable = files.filter(f => seen.files.get(f.name) == now.get(f.name));
        seen.files = now;
        if (!stable.length) return;

        const newest = stable.reduce((a, b) => newer(b, a) ? b : a);
        const key = `${newest.name} ${now.get(newest.name)}`;
        if (seen.last?.key == key)
            return seen.last.buf;

        const path = join(spec.dir, newest.name);
        const content = await this.exclusive(r => r.read(path, MAX_READ));
        const buf = BufferX.fromJSON({
            path,
            name:       newest.name,
            size:       newest.size,
            modified:   newest.modified,
            content:    content.toString(),
        });
        seen.last = { key, buf };
        return buf;
    }

    /* A write forwarded by the edge agent: `command` is the address
     * written to and `data` the value written. The outcome is
     * published on cmd:result. The library doesn't wait for this, so
     * it must never throw; an exception would kill the process. */
    cmd (command, data) {
        const run = this.commands.then(() => this.command(command, data));
        this.commands = run.catch(() => {});
        return run;
    }

    /* Every result has every field, empty where it doesn't apply, so a
     * metric reading one is cleared rather than left with the value
     * from an earlier command. */
    async command (command, data) {
        const spec = parse_addr(command);
        const result = {
            id: "", command: spec?.verb ?? command,
            path: "", from: "", to: "", file: "", size: 0,
            ok: false, error: "", at: null,
        };
        try {
            if (spec?.kind != "cmd" || spec.verb == "result")
                throw new Error(`${command} is not a command address`);
            const args = parse_args(data);
            /* Echoed back, so a caller can match a result to its write. */
            if (args.id != null) result.id = String(args.id);

            switch (spec.verb) {
            case "write":   await this.write(args, result); break;
            case "delete":  await this.delete(args, result); break;
            case "rename":  await this.rename(args, result); break;
            }
            result.ok = true;
        }
        catch (e) {
            result.ok = false;
            result.error = e.message;
            this.log("Command %s failed: %s", command, e.message);
        }
        result.at = new Date().toISOString();
        this.result = result;
        return result;
    }

    /* { path, content } writes text; { path, file } writes a file from
     * the Files service. */
    async write (args, result) {
        const path = result.path = need(args, "path");
        if ((args.content == null) == (args.file == null))
            throw new Error("give exactly one of 'content' and 'file'");

        let data;
        if (args.content != null) {
            if (typeof args.content != "string")
                throw new Error("'content' must be a string");
            data = Buffer.from(args.content);
        }
        else {
            result.file = need(args, "file");
            /* Not under the lock: the fetch doesn't use the server, and
             * polls carry on while it runs. */
            data = await this.fetch(result.file);
        }
        result.size = data.length;

        await this.exclusive(r => this.opts.atomic
            ? write_atomic(r, path, data)
            : r.write(path, data));
    }

    async delete (args, result) {
        const path = result.path = need(args, "path");
        await this.exclusive(r => r.remove(path));
    }

    async rename (args, result) {
        const from = result.from = need(args, "from");
        const to = result.to = need(args, "to");
        await this.exclusive(r => r.rename(from, to));
    }

    /* Ask the edge agent to fetch a file from the Files service. The
     * driver holds no Factory+ credentials; the agent fetches with its
     * own. Requests for the same file share one fetch. */
    fetch (uuid) {
        if (!UUID_RX.test(uuid))
            return Promise.reject(new Error(`'file' is not a UUID: ${uuid}`));

        const pending = this.fetches.get(uuid);
        if (pending) return pending.promise;

        const req = {};
        req.promise = new Promise((resolve, reject) => {
            req.resolve = resolve;
            req.reject = reject;
        });
        req.timer = setTimeout(() => this.settle(uuid,
            new Error("timed out waiting for the edge agent")),
            this.fetch_timeout);
        this.fetches.set(uuid, req);

        this.driver.mqtt.publishAsync(this.driver.topic("req", "file"), uuid)
            .catch(e => this.settle(uuid, e));
        return req.promise;
    }

    settle (uuid, err, buf) {
        const req = this.fetches.get(uuid);
        if (!req) return;
        this.fetches.delete(uuid);
        clearTimeout(req.timer);
        if (err) req.reject(err);
        else req.resolve(buf);
    }

    /* A reply to a file request. An error without a uuid means the
     * agent didn't understand the request at all (it is too old to
     * fetch files), which fails every fetch in flight. */
    rsp (payload, data) {
        if (data != "file") return;

        let body;
        try { body = JSON.parse(payload.toString()); }
        catch { return this.log("Bad rsp/file payload from the edge agent"); }

        if (body.uuid == null) {
            const err = new Error(`edge agent: ${body.error ?? "bad reply"}`);
            for (const uuid of [...this.fetches.keys()])
                this.settle(uuid, err);
            return;
        }
        if (body.error)
            return this.settle(body.uuid, new Error(`edge agent: ${body.error}`));
        this.settle(body.uuid, null, Buffer.from(body.content ?? "", "base64"));
    }
}

/* Later modified time wins. Names break ties, and stand in for the
 * time on servers that can't give one. */
function newer (a, b) {
    if (a.modified != b.modified)
        return (a.modified ?? "") > (b.modified ?? "");
    return a.name > b.name;
}

function parse_args (data) {
    let args;
    try { args = JSON.parse(data.toString()); }
    catch { throw new Error("the value is not JSON"); }
    if (typeof args != "object" || args == null || Array.isArray(args))
        throw new Error("the value must be a JSON object");
    return args;
}

function need (args, key) {
    const val = args[key];
    if (typeof val != "string" || val == "")
        throw new Error(`'${key}' must be a non-empty string`);
    return val;
}

/* Upload under a temporary name and rename it into place, so nothing
 * reading the directory sees a half-written file. */
async function write_atomic (remote, path, data) {
    const slash = path.lastIndexOf("/");
    const tag = crypto.randomBytes(4).toString("hex");
    const tmp = `${path.slice(0, slash + 1)}.${path.slice(slash + 1)}.${tag}.part`;

    try {
        await remote.write(tmp, data);
        await remote.replace(tmp, path);
    }
    catch (e) {
        if (!remote.closed)
            await remote.remove(tmp).catch(() => {});
        throw e;
    }
}
