/* Experiments with expanding s-exprs */

import util from "util";

import imm from "immutable";
import { parse } from "@thi.ng/sexpr";

export const builtins = new Map();
export const permissions = new Set();
export const functions = new Map();

const verbose = process.env.VERBOSE ? console.log : () => {};

function is_scalar (v) { return v == null || typeof v != "object"; }

export function evaluate (expr, ctx) {
    verbose("EVAL[%s] %O %O", ctx.depth,
        Object.fromEntries(ctx.definitions.entries()), expr);

    /* Constants */
    if (is_scalar(expr))
        return [expr];

    /* Recursion */
    if (ctx.depth > 20)
        throw "Recursion exceeded";
    const eve = (x, e) => {
        const rv = evaluate(x, {
            ...ctx,
            depth:          ctx.depth + 1,
            definitions:    e,
        });
        verbose(" -> [%s] %O", ctx.depth + 1, rv);
        return rv;
    };
    const ev = x => eve(x, ctx.definitions);
    const sc = v => {
        if (v.length != 1)
            throw util.format("Expected single element, not %O", v);
        return v[0];
    };
    const sce = x => sc(ev(x));

    /* Evaluate tuple values */
    if (!Array.isArray(expr))
        return [
            Object.fromEntries(
                Object.entries(expr)
                    .map(([k, v]) => [k, sce(v)]))];

    /* Now that we have [get], and given that we don't have lambdas, I'm
     * not sure this evaluation is needed any more. */
    //const name = sc(expr[0]);
    const name = expr[0];

    if (typeof name != "string")
        throw util.format("Unexpected function name: %o", name);

    /* Special forms */
    switch (name) {
        case "quote":
            return expr.slice(1);

        case "let": {
            const [, bind, ...body] = expr;
            const entries = new Map(ctx.definitions);
            for (const bs of Array.isArray(bind) ? bind : [bind]) {
                Object.entries(bs)
                    .map(([k, v]) => [k, eve(v, entries)])
                    .forEach(([k, v]) => entries.set(k, v));
            }
            return body.flatMap(v => eve(v, entries));
        }

        case "if": {
            const cond = sce(expr[1]);
            if (cond) return ev(expr[2]);
            if (expr.length < 3) return [];
            return ev(expr[3]);
        }

        case "map": {
            const [, [bind, ...body], ...list] = expr;
            verbose("MAP: bind %O, body %O, list %O", bind, body, list);
            return list
                .flatMap(ev)
                .map(val => new Map([...ctx.definitions, [bind, [val]]]))
                .flatMap(env => body.flatMap(x => eve(x, env)));
        }

    }

    /* Evaluate arguments */
    const args = expr.slice(1).flatMap(ev);

    /* Builtins cannot be renamed or overridden */
    if (builtins.has(name))
        return builtins.get(name)(...args);

    if (ctx.definitions.has(name)) {
        let rv = ctx.definitions.get(name);
        if (!args.length) return rv;

        rv = sc(rv);
        for (const key of args) {
            if (typeof rv != "object")
                throw util.format("Invalid indexing: %o", args);
            if (rv == null || !(key in rv))
                return null;
            rv = rv[key];
        }
        return [rv];
    }

    if (functions.has(name)) {
        const [param, ...body] = functions.get(name);
        const env = new Map(param.map((p, i) => [p, [args[i]]]));
        return body.flatMap(e => eve(e, env));
    }

    if (permissions.has(name)) 
        return [[name, ...args]];

    throw util.format("Unknown form %s", name);
}

function fail (...args) { throw util.format(...args); }

function sx_to_json (sx) {
    /* fall through is important */
    switch (sx.type) {
        case "root":
            return sx.children.length > 1 
                ? fail("multiple sx")
                : sx_to_json(sx.children[0]); 
        case "sym":
            switch (sx.value) {
                case "null": return null;
                case "true": return true;
                case "false": return false;
            }
        case "str": 
        case "num":
            return sx.value;
        case "expr": 
            switch (sx.value) {
                case "[": 
                    return sx.children.map(sx_to_json); 
                case "{": 
                    return sx.children.reduce(
                        ([key, obj], val) => key
                            ? [null, {...obj, [key]: sx_to_json(val) }]
                            : [val.type == "sym" && val.value.endsWith(":")
                                ? val.value.slice(0, -1)
                                : fail("bad object key: %O", val), obj],
                        [null, {}])[1];
            }
        default:
            fail("unknown sx: %O", sx)
    }
}

function sx (strs) {
    if (strs.length != 1)
        fail("sx with interpolation");
    return sx_to_json(parse(strs[0], { scopes: [["[", "]"], ["{", "}"]] }));
}

function preprocess_expr (expr, ctx) {
    verbose("PREPROCESSING %o", expr);
    if (is_scalar(expr))
        return;

    if (!Array.isArray(expr)) {
        Object.values(expr).forEach(e => preprocess_expr(e, ctx));
        return;
    }

    const [name, ...args] = expr;
    if (name == "lookup") {
        const [svc, url, item] = args;
        if (!is_scalar(svc) || !is_scalar(url))
            throw util.format("Inappropriate args for lookup: %O", args);
        ctx.lookups.add(`${svc}/${url}`);
        preprocess_expr(item, ctx);
    }
    else {
        if (permissions.has(name))
            ctx.perms.add(name);
        if (functions.has(name))
            ctx.calls.add(name);
        args.forEach(e => preprocess_expr(e, ctx));
    }
}
        
function preprocess ([args, ...definition]) {
    const ctx = {
        calls:      new Set(),
        lookups:    new Set(),
        perms:      new Set(),
    };
    definition.forEach(e => preprocess_expr(e, ctx));
    return ctx;
}

function preprocess_all () {
    const meta = new Map();
    for (const [name, definition] of functions.entries()) {
        meta.set(name, preprocess(definition));
    }
    return meta;
}

let principal;
const ids = new Map();
const lookups = new Map();

builtins.set("flat", a => a);
builtins.set("get", (tuple, key) => [tuple[key]]);
builtins.set("has", (tuple, key) => [key in tuple]);
builtins.set("merge", (...tups) => [Object.assign({}, ...tups)]);
builtins.set("format", (f, ...a) => [util.format(f, ...a)]);
builtins.set("list", (...a) => [a]);
builtins.set("lookup", (s, u, a) => {
    const key = `${s}/${u}`.replace("%", a);
    const val = lookups.get(key);
    verbose("LOOKUP: %s -> %o", key, val);
    return val ? [val] : [];
});
builtins.set("principal", () => [principal]);
builtins.set("id", (princ, type) => [ids.get(princ)[type]]);

ids.set("ConfigDB-SA", { sparkplug: { group: "Core", node: "ConfigDB" } });
ids.set("Directory-SA", { sparkplug: { group: "Core", node: "Directory" } });
ids.set("Edge-Cl", { sparkplug: { group: "Edge" } });

lookups.set("ConfigDBSvc/v2/group/EdgeGroups/members",
    ["EdgeAgent", "EdgeSync"]);
lookups.set("ConfigDBSvc/v2/group/Services/members",
    ["ConfigDB-SA", "Directory-SA"]);
lookups.set("DirectorySvc/v1/device/Node",
    { group_id: "Group", node_id: "Node" });
lookups.set("DirectorySvc/v1/device/address/Node",
    { group: "Group", node: "Node" });
lookups.set("DirectorySvc/v1/device/Device",
    { group_id: "Group", node_id: "Node", device_id: "Device" });
lookups.set("DirectorySvc/v1/device/address/Device",
    { group: "Group", node: "Node", device: "Device" });
lookups.set("DirectorySvc/v1/device/address/ConfigDB-SA",
    { group: "Core", node: "ConfigDB" });
lookups.set("DirectorySvc/v1/device/address/Directory-SA",
    { group: "Core", node: "Directory" });

["Unknown", "Publish", "Subscribe", "SendCmd",
    "CreateObject", "ReadConfig", "WriteConfig",
    "ReadIdentity", "WriteIdentity", "ManageGroup",
].forEach(p => permissions.add(p));

functions.set("Id", sx`[[x] [x]]`);
functions.set("Twice", sx`[[y] [y] [y]]`);

functions.set("SpTopic", [["type", "addr"],
    ["if", ["has", ["addr"], "device"],
        ["format", "spBv1.0/%s/D%s/%s/%s",
            ["addr", "group"], 
            ["type"], 
            ["addr", "node"], 
            ["addr", "device"]],
        ["format", "spBv1.0/%s/N%s/%s",
            ["addr", "group"], 
            ["type"], 
            ["addr", "node"]]]]);
functions.set("ParticipateAsNode", sx`[[]
    [let {node: [id [principal] sparkplug]}
        [map [addr
                [Publish [SpTopic "BIRTH" [addr]]]
                [Publish [SpTopic "DATA" [addr]]]
                [Publish [SpTopic "DEATH" [addr]]]
                [Subscribe [SpTopic "CMD" [addr]]]]
            [node]
            [merge [node] { device: "+" }]]]]`);
functions.set("ReadAddress", [["addr"],
      ["map", ["t", ["Subscribe", ["SpTopic", ["t"], ["addr"]]]],
        "BIRTH", "DEATH", "DATA"]]);

functions.set("Rebirth", [["addr"],
      ["SendCmd", {
        address: ["addr"],
        name: ["if", ["has", ["addr"], "device"],
          "Device Control/Rebirth", "Node Control/Rebirth"],
        type: "Boolean",
        value: true,
      }]]);

functions.set("ConsumeNode", [["node"],
      ["let", {"addr": ["id", ["node"], "sparkplug"]},
        ["map", ["a", ["ReadAddress", ["a"]], ["Rebirth", ["a"]]],
          ["addr"], 
          ["merge", ["addr"], { device: "+" }]]]]);
functions.set("ConsumeAddress", [["addr"],
      ["ReadAddress", ["addr"]],
      ["Rebirth", ["addr"]]]);

functions.set("DeviceAddress", [["device"],
      ["let", {"info": ["lookup", "DirectorySvc", "v1/device/%", ["device"]]},
        ["if", ["has", ["info"], "device_id"],
            { group:  ["info", "group_id"],
              node: ["info", "node_id"],
              device: ["info", "device_id"],
            },
            { group: ["info", "group_id"],
              node: ["info", "node_id"],
            }]]]);
functions.set("DeviceAddressDirect", [["device"],
    ["lookup", "DirectorySvc", "v1/device/address/%", ["device"]]]);
functions.set("ConsumeDevice", [["device"],
      ["ConsumeAddress", ["DeviceAddressDirect", ["device"]]]]);

functions.set("Members", [["group"],
    ["flat", ["lookup", 
        "ConfigDBSvc", "v2/group/%/members", ["group"]]]]);

functions.set("ConsumeGroup", [["group"],
    ["map", ["m", ["ConsumeNode", ["m"]]], ["Members", ["group"]]]]);

functions.set("KkForCluster", sx`[[cluster]
    [CreateObject { class: EdgeAccount, uuid: false }]
    [ReadConfig { app: Info, obj: Mine }]
    [WriteConfig { app: Info, obj: Mine }]
    [ReadIdentity { uuid: Mine }]
    [let [{addr: [id [cluster] sparkplug]}
            {group: [addr group]}]
        [WriteIdentity { uuid: Mine, sparkplug: { group: [group] }}]
        [WriteIdentity { uuid: Mine, kerberos: [format "*/%s@REALM" [group]]}]
        [WriteIdentity { uuid: Mine, kerberos: [format "nd1/%s/*@REALM" [group]]}]]
    [map [g [ManageGroup { group: [g], member: Mine}]]
        [Members EdgeGroups]]]`);

const metadata = preprocess_all();

export const ev = v => evaluate(v, { depth: 0, definitions: new Map() });

const logger = new console.Console({
    stdout: process.stdout,
    inspectOptions: {
        depth: null,
        compact: 10,
        breakLength: 90,
    },
});

logger.log("FUNCTIONS: %O", functions);

let failed = [];
function ok (msg, ok) {
    if (ok) {
        logger.log("ok %s", msg);
        return true;
    }
    logger.log("not ok %s", msg);
    failed.push(msg);
    return false;
}

function is (msg, got, want) {
    if (ok(msg, got === want))
        return;
    logger.log("# Got: %O", got);
    logger.log("# Expected: %O", want);
}

function is_deep (msg, got, want) {
    if (ok(msg, imm.is(imm.fromJS(got), imm.fromJS(want))))
        return;
    logger.log("# Got: %O", got);
    logger.log("# Expected: %O", want);
}

function isev (msg, expr, want_a, test) {
    const want = imm.fromJS(want_a).toSet();
    const got = imm.fromJS(ev(expr)).toSet();

    if (ok(msg, imm.is(got, want)))
        return;

    logger.log("# Evaluated %O", expr);
    const not_want = got.subtract(want);
    if (not_want.size > 0)
        logger.log("# Didn't expect %O", not_want.sort().toJS());
    const not_got = want.subtract(got);
    if (not_got.size > 0)
        logger.log("# Didn't get %O", not_got.sort().toJS());
}

is("sx null", sx`null`, null);
is("sx true", sx`true`, true);
is("sx number", sx`1.0`, 1);
is("sx sym", sx`foo`, "foo");
is("sx str", sx`"foo"`, "foo");
is("sx str true", sx`"true"`, "true");
is_deep("sx list", sx`[a b]`, ["a", "b"]);
is_deep("sx obj", sx`{a: b}`, {a: "b"});

isev("number", 1, [1]);
isev("string", "foo", ["foo"]);
isev("tuple", {a: 2}, [{a: 2}]);
isev("get", ["get", {a: 2}, "a"], [2]);
isev("perm", ["Unknown", 2], [["Unknown", 2]]);

isev("quote 1", ["quote", 1], [1]);
isev("quote list", ["quote", [1]], [[1]]);
isev("quote value", {a: ["quote", [2]]}, [{a: [2]}]);

isev("list", ["list", 1], [[1]]);
isev("list", ["list", 1, 2, 3], [[1, 2, 3]]);
isev("list perm", ["list", ["Unknown", 1], ["Unknown", 2]], 
    [[["Unknown", 1], ["Unknown", 2]]]);

isev("if", ["if", true, 1, 2], [1]);
isev("!if", ["if", false, 1, 2], [2]);
isev("merge", ["merge", {a:2}, {b:3}], [{a:2, b:3}]);
isev("has", ["has", {a:2}, "a"], [true]);
isev("!has", ["has", {a:2}, "b"], [false]);
isev("if has", ["if", ["has", {foo:5}, "bar"], "yes", "no"], ["no"]);

isev("map constant", ["map", ["a", 1], 2, 3], [1, 1]);
isev("map expand", ["map", ["a", ["a"]], 2, 3], [2, 3]);
isev("map flatmap", ["map", ["a", ["a"], ["Unknown", ["a"]]], 2, 3],
    [2, ["Unknown", 2], 3, ["Unknown", 3]]);
isev("map scope", sx`[let {a: 2} [map [a [a]] [a]]]`, [2]);

isev("call Id", ["Id", 2], [2]);
isev("call Twice", ["Twice", 4], [4, 4]);
isev("nested call", ["Twice", ["Id", 6]], [6, 6]);
isev("let", sx`[let {a: 4} [a]]`, [4]);
isev("nested let", sx`[let {a: 4} [let {b: 6} [a] [b]]]`, [4, 6]);
isev("recursive let", sx`[let [{a: 4} {b: [Unknown [a]]}] [b]]`, sx`[[Unknown 4]]`);
    
isev("SpTopic node",
    ["SpTopic", "DATA", { group: "Gr", node: "Nd" }],
    ["spBv1.0/Gr/NDATA/Nd"]);
isev("SpTopic device",
    ["SpTopic", "BIRTH", {group: "Gr", node: "Nd", device: "Dv" }],
    ["spBv1.0/Gr/DBIRTH/Nd/Dv"]);

principal = "ConfigDB-SA";
isev("principal", ["principal"], ["ConfigDB-SA"]);
isev("id sparkplug", 
    ["id", ["principal"], "sparkplug"],
    [{group: "Core", node: "ConfigDB"}]);
isev("ParticipateAsNode", ["ParticipateAsNode"],
    [["Publish", "spBv1.0/Core/NBIRTH/ConfigDB"],
    ["Publish", "spBv1.0/Core/NDATA/ConfigDB"],
    ["Publish", "spBv1.0/Core/NDEATH/ConfigDB"],
    ["Publish", "spBv1.0/Core/DBIRTH/ConfigDB/+"],
    ["Publish", "spBv1.0/Core/DDATA/ConfigDB/+"],
    ["Publish", "spBv1.0/Core/DDEATH/ConfigDB/+"],
    ["Subscribe", "spBv1.0/Core/NCMD/ConfigDB"],
    ["Subscribe", "spBv1.0/Core/DCMD/ConfigDB/+"]]);

isev("ReadAddress node",
    ["ReadAddress", { group: "Gr", node: "Nd" }],
    [["Subscribe", "spBv1.0/Gr/NBIRTH/Nd"],
    ["Subscribe", "spBv1.0/Gr/NDATA/Nd"],
    ["Subscribe", "spBv1.0/Gr/NDEATH/Nd"]]);
isev("ConsumeAddress node",
    ["ConsumeAddress", { group: "Gr", node: "Nd" }],
    [["Subscribe", "spBv1.0/Gr/NBIRTH/Nd"],
    ["Subscribe", "spBv1.0/Gr/NDATA/Nd"],
    ["Subscribe", "spBv1.0/Gr/NDEATH/Nd"],
    ["SendCmd", {
        address: { group: "Gr", node: "Nd" },
        name: "Node Control/Rebirth",
        type: "Boolean",
        value: true,
    }]]);
isev("ConsumeAddress device",
    ["ConsumeAddress", { group: "Gr", node: "Nd", device: "Dv" }],
    [["Subscribe", "spBv1.0/Gr/DBIRTH/Nd/Dv"],
    ["Subscribe", "spBv1.0/Gr/DDATA/Nd/Dv"],
    ["Subscribe", "spBv1.0/Gr/DDEATH/Nd/Dv"],
    ["SendCmd", {
        address: { group: "Gr", node: "Nd", device: "Dv" },
        name: "Device Control/Rebirth",
        type: "Boolean",
        value: true,
    }]]);

isev("DeviceAddressDirect Node", ["DeviceAddressDirect", "Node"],
    [{ group: "Group", node: "Node" }]);
isev("DeviceAddressDirect Device", ["DeviceAddressDirect", "Device"],
    [{ group: "Group", node: "Node", device: "Device" }]);
isev("DeviceAddress Node", ["DeviceAddress", "Node"],
    [{ group: "Group", node: "Node" }]);
isev("DeviceAddress Device", ["DeviceAddress", "Device"],
    [{ group: "Group", node: "Node", device: "Device" }]);

isev("ConsumeDevice Node", ["ConsumeDevice", "Node"], [
    ["Subscribe", "spBv1.0/Group/NBIRTH/Node"],
    ["Subscribe", "spBv1.0/Group/NDATA/Node"],
    ["Subscribe", "spBv1.0/Group/NDEATH/Node"],
    ["SendCmd", {
        address: { group: "Group", node: "Node" },
        name: "Node Control/Rebirth",
        type: "Boolean",
        value: true,
    }],
]);
isev("ConsumeDevice Device", ["ConsumeDevice", "Device"], [
    ["Subscribe", "spBv1.0/Group/DBIRTH/Node/Device"],
    ["Subscribe", "spBv1.0/Group/DDATA/Node/Device"],
    ["Subscribe", "spBv1.0/Group/DDEATH/Node/Device"],
    ["SendCmd", {
        address: { group: "Group", node: "Node", device: "Device" },
        name: "Device Control/Rebirth",
        type: "Boolean",
        value: true,
    }],
]);

isev("ConsumeGroup", ["ConsumeGroup", "Services"], [
    ["Subscribe", "spBv1.0/Core/NBIRTH/ConfigDB"],
    ["Subscribe", "spBv1.0/Core/NDATA/ConfigDB"],
    ["Subscribe", "spBv1.0/Core/NDEATH/ConfigDB"],
    ["Subscribe", "spBv1.0/Core/DBIRTH/ConfigDB/+"],
    ["Subscribe", "spBv1.0/Core/DDATA/ConfigDB/+"],
    ["Subscribe", "spBv1.0/Core/DDEATH/ConfigDB/+"],
    ["SendCmd", {
        address: { group: "Core", node: "ConfigDB" },
        name: "Node Control/Rebirth",
        type: "Boolean",
        value: true,
    }],
    ["SendCmd", {
        address: { group: "Core", node: "ConfigDB", device: "+" },
        name: "Device Control/Rebirth",
        type: "Boolean",
        value: true,
    }],
    ["Subscribe", "spBv1.0/Core/NBIRTH/Directory"],
    ["Subscribe", "spBv1.0/Core/NDATA/Directory"],
    ["Subscribe", "spBv1.0/Core/NDEATH/Directory"],
    ["Subscribe", "spBv1.0/Core/DBIRTH/Directory/+"],
    ["Subscribe", "spBv1.0/Core/DDATA/Directory/+"],
    ["Subscribe", "spBv1.0/Core/DDEATH/Directory/+"],
    ["SendCmd", {
        address: { group: "Core", node: "Directory" },
        name: "Node Control/Rebirth",
        type: "Boolean",
        value: true,
    }],
    ["SendCmd", {
        address: { group: "Core", node: "Directory", device: "+" },
        name: "Device Control/Rebirth",
        type: "Boolean",
        value: true,
    }],
]);

isev("KkForCluster", ["KkForCluster", "Edge-Cl"], [
  ["CreateObject", { class: "EdgeAccount", uuid: false }],
  ["ManageGroup", { group: "EdgeAgent", member: "Mine" }],
  ["ManageGroup", { group: "EdgeSync", member: "Mine" }],
  ["ReadConfig", { app: "Info", obj: "Mine" }],
  ["ReadIdentity", { uuid: "Mine" }],
  ["WriteConfig", { app: "Info", obj: "Mine" }],
  ["WriteIdentity", { uuid: "Mine", kerberos: "*/Edge@REALM" }],
  ["WriteIdentity", { uuid: "Mine", kerberos: "nd1/Edge/*@REALM" }],
  ["WriteIdentity", { uuid: "Mine", sparkplug: { group: "Edge" } }]
]);

if (failed.length) {
    console.log("FAILED TESTS: %O", failed);
    throw util.format("%s tests failed", failed.length);
}

logger.log("METADATA: %O", metadata);
const Analysis = imm.Record({
    calls:      imm.Set(),
    lookups:    imm.Set(),
    perms:      imm.Set(),
});
function analyze (name) {
    const rr = f => {
        const m = metadata.get(f);
        const cs = imm.Seq(m.calls);
        return cs.concat(imm.Seq([f]), cs.flatMap(rr))
    };
    const calls = rr(name).toSet();
    return Analysis({
        calls:      calls,
        lookups:    calls.flatMap(f => metadata.get(f).lookups),
        perms:      calls.flatMap(f => metadata.get(f).perms),
    });
}
logger.log("ANALYZE ConsumeGroup: %O", analyze("ConsumeGroup").toJS());
const analysis = imm.Seq.Set(functions.keys())
    .toKeyedSeq()
    .map(analyze)
    .toMap();
logger.log("ANALYSIS: %O", analysis.toJS());

const Requirements = imm.Record({
    grants:     imm.Set(),
    lookups:    imm.Set(),
});
const requirements = analysis.entrySeq()
    .flatMap(([f, a]) => a.perms.map(p => [p, f]))
    .reduce((r, [p, f]) => r.set(p, r.get(p, imm.Set()).add(f)), imm.Map())
    .map((fs, p) => Requirements({
        grants:     fs.flatMap(f => analysis.get(f).calls.add(f)).add(p),
        lookups:    fs.flatMap(f => analysis.get(f).lookups),
    }));
logger.log("REQUIREMENTS: %O", requirements.toJS());

["Unknown", "Publish", "Subscribe", "SendCmd",
    "CreateObject", "ReadConfig", "WriteConfig",
    "ReadIdentity", "WriteIdentity", "ManageGroup",
].forEach(p => permissions.add(p));

const services = imm.Map({
    MQTT:       imm.Set(["Publish", "Subscribe"]),
    CmdEsc:     imm.Set(["SendCmd"]),
    ConfigDB:   imm.Set(["CreateObject", "ReadConfig", "WriteConfig", "ManageGroup"]),
    Auth:       imm.Set(["ReadIdentity", "WriteIdentity"]),
});
const service_req = services
    .map(ps => Requirements({
        grants:     ps.flatMap(p => requirements.get(p).grants),
        lookups:    ps.flatMap(p => requirements.get(p).lookups),
    }));
logger.log("SERVICE REQS: %O", service_req.toJS());