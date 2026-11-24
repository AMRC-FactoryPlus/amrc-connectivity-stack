/*
 * ACS Gateway Depot
 * The gateways and what happens to them.
 * Copyright 2026 University of Sheffield AMRC
 */

import crypto from "crypto";
import timers from "timers/promises";

import { State }        from "./constants.js";
import { DepotError }   from "./errors.js";
import { build_autoinstall, hash_password, random_password }
    from "./autoinstall.js";

const PENDING_EXPIRY = 15 * 60 * 1000;
const ONLINE = 90 * 1000;
const LOG_LIMIT = 16000;
const LOST_JOB = 45 * 1000;

function sha256 (text) {
    return crypto.createHash("sha256").update(text).digest("hex");
}

function same (a, b) {
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length == y.length && crypto.timingSafeEqual(x, y);
}

export class Depot {
    constructor (opts) {
        this.store      = opts.store;
        this.clusters   = opts.clusters;
        this.payload    = opts.payload;
        this.public_url = opts.public_url;
        this.defaults   = opts.defaults;
        this.has_ca     = opts.has_ca;
        /* How often to look for the gateway among its cluster's hosts. */
        this.poll       = opts.poll ?? 10000;

        this.log = opts.fplus.debug.bound("depot");

        this.jobs = new Map();      /* gateway id -> jobs to collect */
        this.running = new Map();   /* gateway id -> job it is working on */
        this.waiters = new Map();   /* job id -> what to call when it ends */
    }

    /* Onboarding is a conversation between this service and a gateway,
     * held in memory. If the service restarted in the middle of one,
     * nobody is left to finish it, so say so and let the person retry. */
    init () {
        for (const box of this.store.list()) {
            if (box.state != State.Onboarding) continue;
            box.state = State.Failed;
            box.onboard = { ...box.onboard, error:
                "The Gateway Depot restarted during the onboarding of this gateway. Try again." };
            this.store.put(box);
        }
        return this;
    }

    settings () {
        return {
            defaults:       { admin_user: this.defaults.admin_user },
            k3s_version:    this.payload.versions.K3S_VERSION,
        };
    }

    /* ---- gateways calling in ---- */

    check_secret (box, secret) {
        if (!box || typeof secret != "string"
            || !same(box.secret_hash, sha256(secret)))
            throw new DepotError(403, "Unknown gateway or wrong secret.");
    }

    append_log (box, text) {
        if (!text) return;
        box.log = ((box.log ?? "") + text).slice(-LOG_LIMIT);
    }

    /* The scout calls this every few seconds from the installer. The
     * first call registers the gateway as waiting for approval. Once
     * someone approves it, the answer carries the installer settings. */
    scout (body, remote_ip) {
        const { id, secret, inventory } = body;
        if (!/^[0-9a-f-]{36}$/.test(id ?? "")
            || typeof secret != "string" || secret.length < 32)
            throw new DepotError(400, "A scout must send an id and a secret.");
        if (!inventory?.nics || !inventory?.disks || !inventory?.arch)
            throw new DepotError(400, "A scout must send its inventory.");

        let box = this.store.get(id);
        if (!box) {
            box = {
                id,
                secret_hash:    sha256(secret),
                state:          State.Pending,
                first_seen:     Date.now(),
            };
            this.log("New gateway waiting for approval: %s (serial %s) from %s",
                id, inventory.serial, remote_ip);
        }
        else {
            this.check_secret(box, secret);
        }

        box.last_seen = Date.now();
        box.remote_ip = remote_ip;
        /* The hardware list is fixed once the gateway is approved, so
         * what was approved is what stays on record. */
        if (box.state == State.Pending) box.inventory = inventory;

        if (box.state == State.Approved) {
            box.state = State.Installing;
            box.install_started_at = Date.now();
            this.store.put(box);
            this.log("Gateway %s collected its settings and is installing", id);
            return {
                state:          "approved",
                autoinstall:    build_autoinstall({
                    box, settings: box.settings,
                    payload: this.payload, public_url: this.public_url,
                }),
            };
        }
        this.store.put(box);
        return { state: box.state };
    }

    /* An installed gateway calls this every few seconds. It says what
     * it is doing, and collects a job if one is waiting. */
    checkin (id, body, remote_ip) {
        const box = this.store.get(id);
        this.check_secret(box, body.secret);

        box.last_seen = Date.now();
        box.remote_ip = remote_ip;
        if (body.report) box.report = body.report;
        this.append_log(box, body.log);

        if (body.phase == "installed" && box.state == State.Installing) {
            box.state = State.Installed;
            box.installed_at = Date.now();
        }
        else if (body.phase == "install-failed"
            && box.state == State.Installing) {
            box.state = State.Failed;
            box.install_failed = true;
            this.log("Gateway %s reported a failed install", box.id);
        }
        else if (body.phase == "ready"
            && [State.Approved, State.Installing, State.Installed]
                .includes(box.state)) {
            box.state = State.Ready;
            box.ready_at = Date.now();
        }
        else if (body.phase == "onboarded" && box.state == State.Ready) {
            /* It finished while this service was not looking. */
            box.state = State.Onboarded;
            box.onboarded_at = Date.now();
        }

        /* The end of a job. Whoever started it is waiting to hear. */
        const running = this.running.get(box.id);
        if (body.job_done && running && body.job_done.id == running.id) {
            this.running.delete(box.id);
            this.finish_job(running.id, body.job_done);
        }
        else if (running && !body.busy && !body.job_done
            && Date.now() - running.delivered > LOST_JOB) {
            /* It was handed the job, is not working on it, and never
             * said how it ended. Its agent must have restarted. */
            this.running.delete(box.id);
            this.finish_job(running.id, { ok: false, error:
                "The gateway stopped working on the job before it finished. Try again." });
        }

        this.store.put(box);

        const queue = this.jobs.get(box.id);
        if (queue?.length && !this.running.has(box.id)) {
            const job = queue.shift();
            this.running.set(box.id, { id: job.id, delivered: Date.now() });
            return { job };
        }
        return {};
    }

    /* Hand a job to a gateway and wait for it to end. Jobs are held in
     * memory only and handed over once. */
    run_job (box, job, timeout) {
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters.delete(id);
                const queue = this.jobs.get(box.id) ?? [];
                this.jobs.set(box.id, queue.filter(j => j.id != id));
                if (this.running.get(box.id)?.id == id)
                    this.running.delete(box.id);
                reject(new DepotError(504, "The gateway did not finish in time."));
            }, timeout);
            /* A job nobody collects must not keep the process alive. */
            timer.unref();
            this.waiters.set(id, { resolve, reject, timer });
            this.jobs.set(box.id,
                [...(this.jobs.get(box.id) ?? []), { ...job, id }]);
        });
    }

    finish_job (id, done) {
        const waiter = this.waiters.get(id);
        if (!waiter) return;
        this.waiters.delete(id);
        clearTimeout(waiter.timer);
        if (done.ok)
            waiter.resolve(done.result ?? {});
        else
            waiter.reject(new DepotError(502,
                done.error ?? "The gateway reported a failure."));
    }

    /* ---- people ---- */

    /* What the Admin UI may see of a gateway. Never the secrets. */
    view (box) {
        // eslint-disable-next-line no-unused-vars
        const { secret_hash, password_hash, ...rest } = box;
        return { ...rest, online: Date.now() - (box.last_seen ?? 0) < ONLINE };
    }

    list () {
        /* A scout that went away before anyone approved it is gone for
         * good, because the next boot makes a new id. */
        for (const box of this.store.list()) {
            if (box.state == State.Pending
                && Date.now() - box.last_seen > PENDING_EXPIRY)
                this.store.remove(box.id);
        }
        return this.store.list()
            .sort((a, b) => b.first_seen - a.first_seen)
            .map(b => this.view(b));
    }

    /* The edge clusters in Factory+. Each says which gateway on the
     * list, if any, is its first gateway: the one another gateway would
     * join. */
    async list_clusters () {
        const boxes = this.store.list();
        return (await this.clusters.list()).map(cluster => ({
            ...cluster,
            gateway: boxes.find(b => b.state == State.Onboarded
                && b.onboard?.mode == "create"
                && b.onboard?.cluster?.uuid == cluster.uuid)?.id,
        }));
    }

    get (id) {
        const box = this.store.get(id);
        if (!box) throw new DepotError(404, "No such gateway.");
        return box;
    }

    /* The gateway a new one is taking the place of, if that is
     * allowed. */
    replaceable (id) {
        const old = this.get(id);
        if (old.onboard?.mode != "create" || !old.onboard?.cluster?.uuid
            || ![State.Onboarded, State.Failed].includes(old.state))
            throw new DepotError(409,
                "You can only replace a gateway that was onboarded as the first gateway of its own edge cluster.");
        if (old.replaced_by)
            throw new DepotError(409, "Another gateway already replaced that one.");
        return old;
    }

    async approve (id, body, who) {
        const box = this.get(id);
        if (box.state != State.Pending)
            throw new DepotError(409, "This gateway is not waiting for approval.");

        const nics = box.inventory.nics.map(n => n.mac);
        const disks = box.inventory.disks.map(d => d.path);
        const s = {
            north_mac:  String(body.north_mac ?? "").toLowerCase(),
            south_mac:  String(body.south_mac ?? "").toLowerCase(),
            south_addr: String(body.south_addr ?? "").trim(),
            disk:       String(body.disk ?? ""),
            admin_user: String(body.admin_user ?? "").trim(),
            ssh_keys:   String(body.ssh_keys ?? "").split("\n")
                .map(l => l.trim()).filter(Boolean),
            label:      String(body.label ?? "").trim().slice(0, 80),
            has_ca:     this.has_ca,
            ...this.defaults,
        };
        /* The default admin user is a default, not an override. */
        if (body.admin_user) s.admin_user = String(body.admin_user).trim();

        if (!nics.includes(s.north_mac))
            throw new DepotError(400, "Choose which port is northbound.");
        if (s.south_mac && !nics.includes(s.south_mac))
            throw new DepotError(400,
                "The southbound port is not a port on this gateway.");
        if (s.south_mac == s.north_mac)
            throw new DepotError(400,
                "The northbound and southbound ports must be different.");
        if (s.south_mac && s.south_addr != "dhcp"
            && !/^\d+(\.\d+){3}\/\d+$/.test(s.south_addr))
            throw new DepotError(400,
                "Give the southbound address as an address with a prefix length, such as 192.168.1.200/24, or the word dhcp.");
        if (!disks.includes(s.disk))
            throw new DepotError(400, "Choose the disk to install on.");
        if (!/^[a-z][a-z0-9_-]{0,30}$/.test(s.admin_user))
            throw new DepotError(400,
                "The admin username must be lowercase letters, digits, - or _.");
        if (s.ssh_keys.some(k => !/^(ssh-|ecdsa-|sk-)\S+ \S+/.test(k)))
            throw new DepotError(400, "One of the SSH keys is not a public key.");

        /* A replacement takes over the dead gateway's edge cluster. It
         * can take its hostname as well, which is what keeps the devices
         * deployed to the old gateway running on the new one, because
         * ACS pins each deployment to a hostname. */
        let replaces;
        if (body.replaces) {
            const old = this.replaceable(String(body.replaces));
            replaces = old.id;
            if (body.keep_hostname !== false && old.report?.hostname)
                s.hostname = old.report.hostname;
        }

        /* Fail now, not 15 minutes into the install. */
        this.payload.k3s_for(box.inventory.arch);

        const password = random_password();
        const approved = {
            ...box,
            password_hash:  hash_password(password),
            settings:       s,
            replaces,
            state:          State.Approved,
            approved_by:    who,
            approved_at:    Date.now(),
        };
        /* From here on the gateway is on record in the ConfigDB. If the
         * ConfigDB will not take it, the gateway stays waiting. */
        await this.store.create(approved);
        this.log("%s approved gateway %s (serial %s)%s", who, box.id,
            box.inventory.serial, replaces ? `, replacing ${replaces}` : "");

        /* The only time the password leaves this service. */
        return {
            gateway:    this.view(approved),
            admin_user: s.admin_user,
            password,
        };
    }

    /* Start onboarding. Everything that can be checked is checked
     * before this returns, so mistakes come back as errors on the form.
     * The slow part then carries on by itself, and the Admin UI follows
     * it through the gateway's state. */
    async onboard (id, body, who) {
        const box = this.get(id);
        if (![State.Ready, State.Failed].includes(box.state)
            || box.install_failed)
            throw new DepotError(409, "This gateway is not ready for onboarding.");
        if (Date.now() - box.last_seen > ONLINE)
            throw new DepotError(409,
                "This gateway is not in contact. Power it on and wait until it is in contact.");

        const mode = body.mode == "join" ? "join" : "create";
        const ob = { mode, by: who, started: Date.now() };
        let work;

        if (mode == "join" && body.server) {
            /* Join the cluster of another gateway on the list. That
             * gateway makes a join token when asked, so nobody has to
             * copy one by hand. */
            const server = this.get(String(body.server));
            if (server.state != State.Onboarded
                || server.onboard?.mode != "create")
                throw new DepotError(409,
                    "Choose a gateway that is onboarded as the first gateway of its cluster.");
            const name = server.report?.hostname ?? "That gateway";
            if (Date.now() - server.last_seen > ONLINE)
                throw new DepotError(409,
                    `${name} is not in contact, so it cannot make a join token.`);
            const north = server.report?.nics
                ?.find(n => n.name == server.report.north);
            const address = north?.ipv4?.split("/")[0];
            if (!address)
                throw new DepotError(409,
                    "That gateway has not reported its northbound address.");
            ob.server = server.id;
            ob.cluster = server.onboard.cluster;
            work = () => this.join_with_server(box, server,
                `https://${address}:6443`);
        }
        else if (mode == "join") {
            /* A cluster this service did not build. */
            if (!/^https:\/\/\S+$/.test(body.k3s_url ?? "") || !body.k3s_token)
                throw new DepotError(400,
                    "Choose the gateway to join, or give the cluster's address (https://host:6443) and its join token.");
            const job = { type: "onboard", mode,
                k3s_url: body.k3s_url, k3s_token: body.k3s_token };
            work = async () => {
                this.step(box, "Waiting for the gateway to join the cluster");
                await this.run_job(box, job, 30 * 60 * 1000);
                this.finish_onboard(box, true);
            };
        }
        else {
            let cluster;
            if (box.replaces) {
                cluster = this.get(box.replaces).onboard.cluster;
            }
            else {
                const name = String(body.cluster_name ?? "").trim();
                if (!name) throw new DepotError(400, "Give the cluster a name.");
                /* A retry reuses the cluster the first attempt made. */
                cluster = box.onboard?.cluster?.name_given == name
                    ? box.onboard.cluster
                    : { ...await this.clusters.create(name), name_given: name };
            }
            ob.cluster = cluster;
            work = () => this.create_and_bootstrap(box, cluster);
        }

        box.onboard = { ...ob, step: "Starting" };
        box.state = State.Onboarding;
        this.store.put(box);

        work().catch(err => {
            this.log("Onboarding %s failed: %s", box.id, err.message);
            box.state = State.Failed;
            box.onboard = { ...box.onboard, error: err.message };
            this.store.put(box);
        });
        return { gateway: this.view(box) };
    }

    step (box, text) {
        box.onboard = { ...box.onboard, step: text, error: undefined };
        this.store.put(box);
    }

    async create_and_bootstrap (box, cluster) {
        this.step(box, "Waiting for Factory+ to prepare the cluster");
        /* The token lets the gateway join without an administrator's
         * credentials. It is good for this cluster only and expires. */
        const { token, bootstrap } = await this.clusters.enrol(cluster.uuid);

        this.step(box, "The gateway is creating its cluster and joining Factory+");
        try {
            await this.run_job(box,
                { type: "onboard", mode: "create",
                    bootstrap_url: bootstrap, token },
                45 * 60 * 1000);
        }
        finally {
            await this.clusters.unenrol(cluster.uuid);
        }
        this.finish_onboard(box, false);

        if (box.replaces) {
            const old = this.store.get(box.replaces);
            if (old) {
                old.state = State.Replaced;
                old.replaced_by = box.id;
                old.replaced_at = Date.now();
                this.store.put(old);
            }
        }

        /* The proof it worked: the edge cluster reports this gateway to
         * Factory+ as one of its hosts. */
        await this.wait_for_host(box, cluster.uuid);
    }

    async join_with_server (box, server, k3s_url) {
        const name = server.report?.hostname ?? "the first gateway";
        this.step(box, `Asking ${name} for a join token`);
        const { token } = await this.run_job(server,
            { type: "join-token" }, 5 * 60 * 1000);
        if (!token)
            throw new DepotError(502, `${name} did not return a join token.`);

        this.step(box, `The gateway is joining the cluster of ${name}`);
        await this.run_job(box,
            { type: "onboard", mode: "join", k3s_url, k3s_token: token },
            30 * 60 * 1000);
        this.finish_onboard(box, false);
        await this.wait_for_host(box, server.onboard.cluster.uuid);
    }

    finish_onboard (box, reported) {
        box.state = State.Onboarded;
        box.onboarded_at = Date.now();
        box.onboard = { ...box.onboard, error: undefined, reported,
            step: reported ? "Finished"
                : "Waiting for Factory+ to see the gateway" };
        this.store.put(box);
        this.log("Gateway %s is onboarded", box.id);
    }

    async wait_for_host (box, cluster_uuid) {
        const end = Date.now() + 45 * 60 * 1000;
        while (Date.now() < end) {
            await timers.setTimeout(this.poll, undefined, { ref: false });
            const now = this.store.get(box.id);
            if (!now || now.state != State.Onboarded) return;
            const clusters = await this.clusters.list().catch(() => []);
            const hosts = clusters.find(c => c.uuid == cluster_uuid)?.hosts ?? [];
            if (hosts.includes(now.report?.hostname)) {
                now.onboard = { ...now.onboard, reported: true,
                    step: "Factory+ can see the gateway" };
                this.store.put(now);
                this.log("Factory+ lists %s as a host of its edge cluster",
                    now.report.hostname);
                return;
            }
        }
    }

    async forget (id, who) {
        const box = this.get(id);
        if (box.state == State.Onboarding)
            throw new DepotError(409,
                "Onboarding of this gateway is in progress. Wait until it finishes.");
        this.jobs.delete(box.id);
        this.running.delete(box.id);
        await this.store.remove(box.id);
        this.log("%s removed gateway %s from the list", who, box.id);
    }
}
