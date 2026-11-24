/*
 * ACS Edge Agent
 * Edge Scout end-to-end tests: checks of the harness itself, which
 * run in every jest run
 * Copyright 2026 University of Sheffield
 */

import http from "http";
import zlib from "zlib";

import { driver_acl } from "../../lib/driverBroker";
import * as UUIDs from "../../lib/uuids";

import { pre_680_acl, pre_scout_acl } from "./e2e/old-agent";
import { AGENT, FakeAcs, load_agent } from "./e2e/services";

const OBJ = "00000000-0000-4000-8000-0000000000f1";
const CONN = "00000000-0000-4000-8000-0000000000c1";

function call (acs: FakeAcs, method: string, path: string, opts: {
    body?: Buffer | string, auth?: string, headers?: Record<string, string>,
} = {}): Promise<{ status: number, body: Buffer, type?: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(acs.url + path, {
            method,
            headers: { Authorization: opts.auth ?? "Bearer tok-1", ...opts.headers },
        }, res => {
            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks),
                type: res.headers["content-type"] }));
        });
        req.on("error", reject);
        req.end(opts.body);
    });
}

describe("the fake central services", () => {
    let acs: FakeAcs;

    beforeEach(async () => {
        acs = await new FakeAcs().start();
        load_agent(acs, { sparkplug: {}, deviceConnections: [{ uuid: CONN, connType: "Driver" }] });
    });
    afterEach(() => acs.stop());

    it("gives a token for Basic auth and refuses requests without one", async () => {
        expect((await call(acs, "POST", "/token", { auth: "Negotiate x" })).status).toBe(401);
        const tok = await call(acs, "POST", "/token", { auth: "Basic ZTpl" });
        expect(tok.status).toBe(200);
        expect(JSON.parse(tok.body.toString()).token).toMatch(/^tok-/);
        expect((await call(acs, "GET", "/authz/principal/find", { auth: "" })).status).toBe(401);
    });

    it("answers who the agent is, where every service is, and the agent's config", async () => {
        const find = await call(acs, "GET", "/authz/principal/find");
        expect(JSON.parse(find.body.toString())).toBe(AGENT.uuid);
        const dir = await call(acs, "GET", `/v1/service/${UUIDs.Service.Files}`);
        expect(JSON.parse(dir.body.toString())).toEqual([
            { service: UUIDs.Service.Files, url: acs.url, device: null }]);
        const conf = await call(acs, "GET", `/v1/app/${UUIDs.App.AgentConfig}/object/${AGENT.uuid}`);
        expect(conf.type).toBe("application/json");
        expect(JSON.parse(conf.body.toString()).deviceConnections[0].uuid).toBe(CONN);
    });

    it("keeps status writes in order and lists the states once each", async () => {
        const put = (state: string) => call(acs, "PUT",
            `/v1/app/${UUIDs.App.ScoutStatus}/object/${CONN}`,
            { body: JSON.stringify({ version: 1, state }), headers: { "Content-Type": "application/json" } });
        expect((await put("queued")).status).toBe(201);
        expect((await put("running")).status).toBe(204);
        await put("running");
        await put("done");
        expect(acs.states(CONN)).toEqual(["queued", "running", "done"]);
        expect(acs.status(CONN).state).toBe("done");
        /* A config for an object ConfigDB doesn't have is refused. */
        expect((await call(acs, "PUT", `/v1/app/${UUIDs.App.ScoutStatus}/object/${OBJ}`,
            { body: "{}" })).status).toBe(404);
    });

    it("stores a snapshot only in an existing File object, once", async () => {
        const gz = zlib.gzipSync(Buffer.from('{"a":1}\n{"b":2}\n'));
        expect((await call(acs, "PUT", `/v1/file/${OBJ}`, { body: gz })).status).toBe(404);

        const made = await call(acs, "POST", "/v1/object",
            { body: JSON.stringify({ class: UUIDs.Class.ScoutResult, uuid: OBJ }) });
        expect(made.status).toBe(201);
        expect((await call(acs, "POST", "/v1/object",
            { body: JSON.stringify({ class: UUIDs.Class.ScoutResult, uuid: OBJ }) })).status).toBe(200);

        expect((await call(acs, "PUT", `/v1/file/${OBJ}`, { body: gz })).status).toBe(201);
        expect((await call(acs, "PUT", `/v1/file/${OBJ}`, { body: gz })).status).toBe(409);
        expect(acs.snapshot(OBJ)).toEqual([{ a: 1 }, { b: 2 }]);
        const got = await call(acs, "GET", `/v1/file/${OBJ}`);
        expect(got.body.equals(gz)).toBe(true);
        expect(acs.scout_objects()).toEqual([OBJ]);

        expect((await call(acs, "DELETE", `/v1/file/${OBJ}`)).status).toBe(204);
        expect((await call(acs, "DELETE", `/v1/object/${OBJ}`)).status).toBe(204);
        expect((await call(acs, "DELETE", `/v1/file/${OBJ}`)).status).toBe(403);
        expect(acs.scout_objects()).toEqual([]);
        expect(acs.calls.filter(c => c.startsWith("DELETE"))).toEqual([
            `DELETE /v1/file/${OBJ} 204`, `DELETE /v1/object/${OBJ} 204`, `DELETE /v1/file/${OBJ} 403`]);
    });

    it("counts an upload sent again with the same body after a 401", async () => {
        await call(acs, "POST", "/v1/object",
            { body: JSON.stringify({ class: UUIDs.Class.ScoutResult, uuid: OBJ }) });
        acs.expire_next_upload = true;
        expect((await call(acs, "PUT", `/v1/file/${OBJ}`, { body: "abc" })).status).toBe(401);
        expect((await call(acs, "PUT", `/v1/file/${OBJ}`, { body: "abc" })).status).toBe(201);
        expect(acs.uploads_retried).toBe(1);
    });
});

describe("the stand-in agents' ACLs", () => {
    const t = (s: string) => `fpEdge1/d/${s}`;

    it("keeps the driver ACL from before v6.8.0", () => {
        const acl = pre_680_acl("d");
        for (const ok of ["status", "data/a", "err/a"]) expect(acl.publish.test(t(ok))).toBe(true);
        for (const no of ["req/a", "result/a", "found/a"]) expect(acl.publish.test(t(no))).toBe(false);
        for (const ok of ["active", "conf", "addr", "cmd/#", "poll"]) expect(acl.subscribe.test(t(ok))).toBe(true);
        for (const no of ["rsp/a", "write/#", "scout"]) expect(acl.subscribe.test(t(no))).toBe(false);
    });

    it("keeps ACS 7's driver ACL as it was before scouting", () => {
        const acl = pre_scout_acl("d"), now = driver_acl("d");
        for (const topic of ["status", "data/a", "err/a", "req/a", "result/a"])
            expect(acl.publish.test(t(topic))).toBe(true);
        for (const topic of ["active", "conf", "addr", "cmd/#", "write/#", "poll", "rsp/a"])
            expect(acl.subscribe.test(t(topic))).toBe(true);
        /* Scouting is the only difference from this release. */
        expect(acl.publish.test(t("found/a"))).toBe(false);
        expect(now.publish.test(t("found/a"))).toBe(true);
        expect(acl.subscribe.test(t("scout"))).toBe(false);
        expect(now.subscribe.test(t("scout"))).toBe(true);
    });
});
