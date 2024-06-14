/* Experiments with expanding s-exprs */

import util from "util";

import imm from "immutable";

export const builtins = new Map();
export const expanders = new Set();
export const functions = new Map();

const verbose = process.env.VERBOSE ? console.log : () => {};

/* Might this form expand to a list? */
function expandable (f, definitions) {
    if (!Array.isArray(f))
        return false;
    if (functions.has(f[0]))
        return true;
    if (definitions.has(f[0]))
        return true;
    if (expanders.has(f[0]))
        return true;
    return false;
}

export function evaluate (depth, definitions, expr) {
    verbose("EVAL[%s] %O %O", depth, definitions, expr);

    /* Constants */
    if (expr == null || typeof expr != "object")
        return [expr];

    /* Recursion */
    if (depth > 20)
        throw "Recursion exceeded";
    const eve = (x, e) => {
        const rv = evaluate(depth + 1, e, x);
        verbose(" -> [%s] %O", depth + 1, rv);
        return rv;
    };
    const ev = x => eve(x, definitions);
    const sc = x => {
        const v = ev(x);
        if (v.length != 1)
            throw util.format("Expected single element, not %O", v);
        return v[0];
    };

    /* Evaluate tuple values */
    if (!Array.isArray(expr))
        return [
            Object.fromEntries(
                Object.entries(expr)
                    .map(([k, v]) => [k, sc(v)]))];

    /* Now that we have [get], and given that we don't have lambdas, I'm
     * not sure this evaluation is needed any more. */
    const name = sc(expr[0]);

    if (Array.isArray(name))
        throw "Unexpected list as function name";

    const letbind = (bind, body) => {
        const entries = new Map(definitions);
        for (let i = 0; i < bind.length; i += 2)
            /* This is let* */
            entries.set(bind[i], eve(bind[i + 1], entries));
        return body.flatMap(v => eve(v, entries));
    };

    /* Special forms */
    switch (name) {
        case "quote":
            return expr.slice(1);

        case "list":
            return expr.slice(1).flatMap(ev);

        case "let": {
            const [, bind, ...body] = expr;
            return letbind(bind, body);
        }

        case "if": {
            const cond = sc(expr[1]);
            const listify = l => l.length == 1 ? l[0] : ["list", ...l];
            if (Array.isArray(cond))
                return [["if", cond, 
                    listify(ev(expr[2])),
                    listify(ev(expr[3]))]];
            if (cond) return ev(expr[2]);
            if (expr.length < 3) return [];
            return ev(expr[3]);
        }

        case "map": {
            const [bind, ...body] = expr[1];
            const list = expr.slice(2).flatMap(ev);
            if (list.some(v => expandable(v, definitions)))
                return [["map", 
                    [bind, ...letbind([bind, ["quote", [bind]]], body)],
                    ...list]];
            return list
                .map(v => ["list", v])
                .flatMap(e => letbind([bind, e], body));
        }
    }

    /* Evaluate arguments */
    const args = expr.slice(1).flatMap(ev);

    /* Builtins cannot be renamed or overridden */
    if (builtins.has(name)) {
        /* Unevaluated arguments mean the whole call must be deferred */
        if (args.some(Array.isArray))
            return [[name, ...args]];
        return builtins.get(name)(...args);
    }

    if (definitions.has(name))
        return definitions.get(name);

    if (functions.has(name)) {
        const [param, ...body] = functions.get(name);
        const bind = param.flatMap((p, i) => [p, args[i]]);
        return letbind(bind, body);
    }

    /* We return a list (everything is flatmapped), so we need to quote
     * an unevaluated form to return it. */
    return [[name, ...args]];
}

/* Forms which may require flatmapping if left unevaluated */
expanders.add("list");
expanders.add("let");
expanders.add("if");
expanders.add("map");
expanders.add("lookup");
expanders.add("members");

builtins.set("get", (tuple, key) => [tuple[key]]);
builtins.set("has", (tuple, key) => [key in tuple]);
builtins.set("merge", (...tups) => [Object.assign({}, ...tups)]);
builtins.set("format", (f, ...a) => [util.format(f, ...a)]);

builtins.set("principal", () => ["ConfigDB-SA"]);
const ids = new Map();
ids.set("ConfigDB-SA", { sparkplug: { group: "Core", node: "ConfigDB" } });
builtins.set("id", (princ, type) => [ids.get(princ)[type]]);

functions.set("Id", [["x"], ["x"]]);
functions.set("Twice", [["y"], ["y"], ["y"]]);

functions.set("SpTopic", [["type", "addr"],
    ["if", ["has", ["addr"], "device"],
        ["format", "spBv1.0/%s/D%s/%s/%s",
            ["get", ["addr"], "group"], 
            ["type"], 
            ["get", ["addr"], "node"], 
            ["get", ["addr"], "device"]],
        ["format", "spBv1.0/%s/N%s/%s",
            ["get", ["addr"], "group"], 
            ["type"], 
            ["get", ["addr"], "node"]]]]);
functions.set("ParticipateAsNode", [[], 
    ["let", ["node", ["id", ["principal"], "sparkplug"]],
        ["map", ["addr",
                ["Publish", ["SpTopic", "BIRTH", ["addr"]]],
                ["Publish", ["SpTopic", "DATA", ["addr"]]],
                ["Publish", ["SpTopic", "DEATH", ["addr"]]],
                ["Subscribe", ["SpTopic", "CMD", ["addr"]]]],
            ["node"],
            ["merge", ["node"], { device: "+" }]]]]);
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
      ["let", ["addr", ["id", ["node"], "sparkplug"]],
        ["map", ["a", ["ReadAddress", ["a"]], ["Rebirth", ["a"]]],
          ["addr"], 
          ["merge", ["addr"], { device: "+" }]]]]);
functions.set("ConsumeAddress", [["addr"],
      ["ReadAddress", ["addr"]],
      ["Rebirth", ["addr"]]]);

functions.set("DeviceAddress", [["device"],
      ["let", ["info", ["lookup", "DirectorySvc", "v1/device/", ["device"]]],
        ["if", ["has", ["info"], "device_id"],
            { group:  ["get", ["info"], "group_id"],
              node: ["get", ["info"], "node_id"],
              device: ["get", ["info"], "device_id"],
            },
            { group: ["get", ["info"], "group_id"],
              node: ["get", ["info"], "node_id"],
            }]]]);
functions.set("DeviceAddressDirect", [["device"],
    ["lookup", "DirectorySvc", "v1/device/address/", ["device"]]]);
functions.set("ConsumeDevice", [["device"],
      ["ConsumeAddress", ["DeviceAddressDirect", ["device"]]]]);
functions.set("ConsumeGroup", [["group"],
    ["map", ["m", ["ConsumeDevice", ["m"]]],
        ["members", ["group"]]]]);

export const ev = v => evaluate(0, new Map(), v);

const logger = new console.Console({
    stdout: process.stdout,
    inspectOptions: {
        depth: null,
        compact: 10,
        breakLength: 90,
    },
});

function is (msg, expr, want) {
    const got = imm.fromJS(ev(expr)).toSet();
    if (imm.fromJS(want).toSet().equals(got)) {
        logger.log("ok %s", msg);
        return;
    }
    logger.log("not ok %s\nEvaluated %O\nExpected %O\nGot %O",
        msg, expr, want, got.toJS());
    throw "Test failed";
}

is("number", 1, [1]);
is("string", "foo", ["foo"]);
is("tuple", {a: 2}, [{a: 2}]);
is("get", ["get", {a: 2}, "a"], [2]);
is("unevaluated", ["Unknown", 2], [["Unknown", 2]]);

is("list", ["list", 1], [1]);
is("list", ["list", 1, 2, 3], [1, 2, 3]);
is("list uneval", ["list", ["Uk", 1], ["Uk", 2]], [["Uk", 1], ["Uk", 2]]);

is("if", ["if", true, 1, 2], [1]);
is("!if", ["if", false, 1, 2], [2]);
is("merge", ["merge", {a:2}, {b:3}], [{a:2, b:3}]);
is("has", ["has", {a:2}, "a"], [true]);
is("!has", ["has", {a:2}, "b"], [false]);
is("if has", ["if", ["has", {foo:5}, "bar"], "yes", "no"], ["no"]);

is("map constant", ["map", ["a", 1], 2, 3], [1, 1]);
is("map expand", ["map", ["a", ["a"]], 2, 3], [2, 3]);
is("map flatmap", ["map", ["a", ["a"], ["Unk", ["a"]]], 2, 3],
    [2, ["Unk", 2], 3, ["Unk", 3]]);
is("map unevaluated",
    ["map", ["a", ["Grant", ["a"]]], ["lookup", "Group"]],
    [["map", ["a", ["Grant", ["a"]]], ["lookup", "Group"]]]);
is("map uneval expand bindings",
    ["let", ["a", 2], ["map", ["b", ["Gr", ["a"], ["b"]]], ["lookup"]]],
    [["map", ["b", ["Gr", 2, ["b"]]], ["lookup"]]]);
is("map uneval scope",
    ["let", ["a", 2], ["map", ["a", ["a"]], ["lookup"]]],
    [["map", ["a", ["a"]], ["lookup"]]]);

is("call Id", ["Id", 2], [2]);
is("call Twice", ["Twice", 4], [4, 4]);
is("nested call", ["Twice", ["Id", 6]], [6, 6]);
is("let", ["let", ["a", 4], ["a"]], [4]);
is("nested let", 
    ["let", ["a", 4], ["let", ["b", 6], ["a"], ["b"]]],
    [4, 6]);
is("recursive let",
    ["let", ["a", 4, "b", ["Ck", ["a"]]], ["b"]],
    [["Ck", 4]]);
    
is("SpTopic node",
    ["SpTopic", "DATA", { group: "Gr", node: "Nd" }],
    ["spBv1.0/Gr/NDATA/Nd"]);
is("SpTopic device",
    ["SpTopic", "BIRTH", {group: "Gr", node: "Nd", device: "Dv" }],
    ["spBv1.0/Gr/DBIRTH/Nd/Dv"]);
is("principal", ["principal"], ["ConfigDB-SA"]);
is("id sparkplug", 
    ["id", ["principal"], "sparkplug"],
    [{group: "Core", node: "ConfigDB"}]);
is("ParticipateAsNode", ["ParticipateAsNode"],
    [["Publish", "spBv1.0/Core/NBIRTH/ConfigDB"],
    ["Publish", "spBv1.0/Core/NDATA/ConfigDB"],
    ["Publish", "spBv1.0/Core/NDEATH/ConfigDB"],
    ["Publish", "spBv1.0/Core/DBIRTH/ConfigDB/+"],
    ["Publish", "spBv1.0/Core/DDATA/ConfigDB/+"],
    ["Publish", "spBv1.0/Core/DDEATH/ConfigDB/+"],
    ["Subscribe", "spBv1.0/Core/NCMD/ConfigDB"],
    ["Subscribe", "spBv1.0/Core/DCMD/ConfigDB/+"]]);

is("ReadAddress node",
    ["ReadAddress", { group: "Gr", node: "Nd" }],
    [["Subscribe", "spBv1.0/Gr/NBIRTH/Nd"],
    ["Subscribe", "spBv1.0/Gr/NDATA/Nd"],
    ["Subscribe", "spBv1.0/Gr/NDEATH/Nd"]]);
is("ConsumeAddress node",
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
is("ConsumeAddress device",
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

{
    const dev = ["lookup", "DirectorySvc", "v1/device/", "ConfigDB-SA"];
    is("DeviceAddress expanded", ["DeviceAddress", "ConfigDB-SA"], [
        ["if", ["has", dev, "device_id"],
            {   group:  ["get", dev, "group_id"],
                node:   ["get", dev, "node_id"],
                device: ["get", dev, "device_id"],
            },
            {   group:  ["get", dev, "group_id"],
                node:   ["get", dev, "node_id"],
            }],
    ]);
}
{
    const dev = ["lookup", "DirectorySvc", "v1/device/address/", "ConfigDB-SA"];
    const ntopic = t => ["format", "spBv1.0/%s/N%s/%s",
        ["get", dev, "group"], t, ["get", dev, "node"]];
    const dtopic = t => ["format", "spBv1.0/%s/D%s/%s/%s",
        ["get", dev, "group"], t, ["get", dev, "node"], ["get", dev, "device"]];
    const topic = t => ["if", ["has", dev, "device"], dtopic(t), ntopic(t)];

    is("DeviceAddress direct", ["DeviceAddressDirect", "ConfigDB-SA"], [dev]);
    is("ConsumeDevice", ["ConsumeDevice", "ConfigDB-SA"], [
        ["Subscribe", topic("BIRTH")],
        ["Subscribe", topic("DATA")],
        ["Subscribe", topic("DEATH")],
        ["SendCmd", {
            address: dev,
            name: ["if", ["has", dev, "device"],
                "Device Control/Rebirth", "Node Control/Rebirth"],
            type: "Boolean",
            value: true,
        }],
    ]);
}
