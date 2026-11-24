/*
 * ACS OPC UA driver
 * The test server's address space and limits for scanning
 * Copyright 2026 University of Sheffield
 */

/* With SCOUT set, server.cjs adds this under Objects, all in ns=1 with
 * string ids, which tests/scout.rs knows by heart:
 *
 *   Scout                       a folder holding the rest
 *   Scout/Tree                  a tree 6 levels deep: folders
 *                               Scout/Tree/<a>/<b>/<c>/<d> with a, b,
 *                               c and d 0 to 3, and in each of the 256
 *                               deepest folders 18 variables
 *                               .../<d>/v<e>, of type Double, Int32,
 *                               Boolean and String by e % 4. 4,949
 *                               nodes in all
 *   Scout/Big/<i>               2,500 UInt16 variables in one folder
 *                               Scout/Big
 *   Scout/Loop, Loop/A, Loop/B  folders where B organizes A, a cycle
 *   Scout/P1, Scout/P2          folders that both hold Scout/Shared
 *   Scout/Secure                a folder holding Scout/Secure/Hidden,
 *                               which user `test` may not browse
 *   Scout/Arr                   a Double array of 4
 *   Scout/Matrix                a 2 by 3 Int32 matrix
 *   Scout/Long                  a Double array of 100
 *   Scout/Huge                  a Double array of 5,000 with no
 *                               ArrayDimensions, as many servers
 *                               leave them, which is more elements
 *                               than the client decodes by default
 *   Scout/State                 a ServerState enumeration
 *   Scout/When                  a UtcTime
 *   Scout/Speed                 an AnalogItem in rpm, with its
 *                               EURange and EngineeringUnits properties
 *   Scout/Blob, Scout/Text, Scout/Build
 *                               a ByteString, a LocalizedText and a
 *                               BuildInfo structure
 *   Scout/Refused               how many Browse requests the server
 *                               has refused as too big
 *   Scout/OpenCPs               how many continuation points the
 *                               server holds for every session
 *
 * SCOUT_SIZE adds that many variables under Plant, as
 * Plant/Area<nn>/Line<nn>/Cell<nn>/<Signal>_<nn>, 50 to a cell, 10
 * cells to a line and 10 lines to an area, each with a description.
 *
 * SCOUT_WIDE adds that many folders Wide/<f> under Objects, each of
 * 1,000 UInt16 variables with string ids of about 400 characters, so
 * a Browse of a few of them at once is over the client's 2 MiB
 * message size. */

const {
    DataType, Variant, VariantArrayType, StatusCodes, LocalizedText,
    BrowseResult, standardUnits, coerceNodeId,
} = require("node-opcua");

const TREE_FANOUT = 4;
const TREE_LEVELS = 4;
const TREE_LEAVES = 18;
const BIG = 2500;
const TYPES = [
    [DataType.Double, 1.5],
    [DataType.Int32, 7],
    [DataType.Boolean, true],
    [DataType.String, "on"],
];
const SIGNALS = ["Temperature", "Pressure", "Speed", "Running", "Count"];
const HUGE = 5000;
const WIDE = 1000;
const WIDE_PAD = "x".repeat(380);

/* Browse requests refused with BadTooManyOperations. */
let refused = 0;

function operation_limits (env) {
    const limits = {};
    const browse = env.MAX_NODES_PER_BROWSE || (env.SCOUT ? 10 : 0);
    if (browse) limits.maxNodesPerBrowse = Number(browse);
    if (env.MAX_NODES_PER_READ) limits.maxNodesPerRead = Number(env.MAX_NODES_PER_READ);
    return limits;
}

function build (server, env) {
    const space = server.engine.addressSpace;
    const ns = space.getOwnNamespace();

    if (env.HIDE_LIMITS) {
        for (const id of ["ns=0;i=11710", "ns=0;i=11705"])
            space.findNode(id).bindVariable({
                get: () => new Variant({ dataType: DataType.UInt32, value: 0 }),
            }, true);
    }
    wrap_browse(server, env);

    if (env.SCOUT) scout_space(server, space, ns);
    if (env.SCOUT_SIZE) plant(space, ns, Number(env.SCOUT_SIZE));
    if (env.SCOUT_WIDE) wide(space, ns, Number(env.SCOUT_WIDE));
}

function wide (space, ns, folders) {
    const top = ns.addFolder(space.rootFolder.objects, { browseName: "Wide", nodeId: "s=Wide" });
    for (let f = 0; f < folders; f++) {
        const fp = `Wide/${f}`;
        const folder = ns.addFolder(top, { browseName: `F${f}`, nodeId: `s=${fp}` });
        for (let i = 0; i < WIDE; i++) {
            ns.addVariable({
                componentOf: folder, browseName: `T${i}`,
                nodeId: `s=${fp}/${WIDE_PAD}/${i}`,
                dataType: DataType.UInt16, minimumSamplingInterval: 0,
            }).setValueFromSource(new Variant({ dataType: DataType.UInt16, value: i }));
        }
    }
}

/* Delay Browse and BrowseNext, cap the references per node, and deny
 * user `test` a browse of Scout/Secure. */
function wrap_browse (server, env) {
    const delay = Number(env.BROWSE_DELAY_MS || 0);
    const max_refs = Number(env.MAX_REFS_PER_NODE || 0);

    const browse = server._on_BrowseRequest;
    server._on_BrowseRequest = function (message, channel) {
        const req = message.request;
        const most = server.engine.serverCapabilities.operationLimits.maxNodesPerBrowse;
        if (most && req.nodesToBrowse?.length > most) refused++;
        if (max_refs && (req.requestedMaxReferencesPerNode == 0
                || req.requestedMaxReferencesPerNode > max_refs))
            req.requestedMaxReferencesPerNode = max_refs;
        setTimeout(() => browse.call(this, message, channel), delay);
    };
    const next = server._on_BrowseNextRequest;
    server._on_BrowseNextRequest = function (message, channel) {
        setTimeout(() => next.call(this, message, channel), delay);
    };

    const engine = server.engine;
    const expand = engine.browseWithAutomaticExpansion;
    const secure = coerceNodeId("ns=1;s=Scout/Secure");
    engine.browseWithAutomaticExpansion = async function (nodes, context) {
        const results = await expand.call(this, nodes, context);
        const user = context?.session?.userIdentityToken?.userName;
        if (user == "test")
            nodes.forEach((n, i) => {
                if (coerceNodeId(n.nodeId).toString() == secure.toString())
                    results[i] = new BrowseResult({ statusCode: StatusCodes.BadUserAccessDenied });
            });
        return results;
    };
}

function scout_space (server, space, ns) {
    const top = ns.addFolder(space.rootFolder.objects, { browseName: "Scout", nodeId: "s=Scout" });
    const folder = (parent, id, name) =>
        ns.addFolder(parent, { browseName: name, nodeId: `s=${id}` });
    const variable = (parent, id, name, dataType, value, opts = {}) => {
        const v = ns.addVariable({
            componentOf: parent, browseName: name, nodeId: `s=${id}`, dataType,
            minimumSamplingInterval: 0, ...opts,
        });
        if (value !== undefined)
            v.setValueFromSource(new Variant({ dataType, value, ...(opts.variant || {}) }));
        return v;
    };

    /* The deep tree. */
    const tree = folder(top, "Scout/Tree", "Tree");
    const grow = (parent, path, level) => {
        for (let i = 0; i < TREE_FANOUT; i++) {
            const id = `${path}/${i}`;
            const f = folder(parent, id, `F${i}`);
            if (level + 1 < TREE_LEVELS) {
                grow(f, id, level + 1);
                continue;
            }
            for (let e = 0; e < TREE_LEAVES; e++) {
                const [dataType, value] = TYPES[e % TYPES.length];
                variable(f, `${id}/v${e}`, `V${e}`, dataType, value);
            }
        }
    };
    grow(tree, "Scout/Tree", 0);

    /* A folder that needs continuation points. */
    const big = folder(top, "Scout/Big", "Big");
    for (let i = 0; i < BIG; i++)
        variable(big, `Scout/Big/${i}`, `B${i}`, DataType.UInt16, i);

    /* An Organizes cycle, and a node with two parents. */
    const loop = folder(top, "Scout/Loop", "Loop");
    const a = folder(loop, "Scout/Loop/A", "A");
    const b = folder(a, "Scout/Loop/B", "B");
    b.addReference({ referenceType: "Organizes", nodeId: a.nodeId });
    const p1 = folder(top, "Scout/P1", "P1");
    const p2 = folder(top, "Scout/P2", "P2");
    const shared = variable(p1, "Scout/Shared", "Shared", DataType.Int32, 5);
    p2.addReference({ referenceType: "Organizes", nodeId: shared.nodeId });

    /* A branch user `test` may not browse. */
    const secure = folder(top, "Scout/Secure", "Secure");
    variable(secure, "Scout/Secure/Hidden", "Hidden", DataType.Double, 0);

    /* Arrays. */
    const array = (id, dataType, dims, values) => variable(top, id, id.split("/")[1], dataType,
        values, {
            valueRank: dims.length, arrayDimensions: dims,
            variant: {
                arrayType: dims.length > 1 ? VariantArrayType.Matrix : VariantArrayType.Array,
                ...(dims.length > 1 ? { dimensions: dims } : {}),
            },
        });
    array("Scout/Arr", DataType.Double, [4], new Float64Array([1, 2, 3, 4]));
    array("Scout/Matrix", DataType.Int32, [2, 3], new Int32Array([1, 2, 3, 4, 5, 6]));
    array("Scout/Long", DataType.Double, [100], new Float64Array(100).fill(0.5));
    variable(top, "Scout/Huge", "Huge", DataType.Double,
        new Float64Array(HUGE).map((_, i) => i), {
            valueRank: 1,
            variant: { arrayType: VariantArrayType.Array },
        });

    /* Types that need a lookup or have none. */
    variable(top, "Scout/State", "State", "ServerState", undefined)
        .setValueFromSource(new Variant({ dataType: DataType.Int32, value: 0 }));
    variable(top, "Scout/When", "When", "UtcTime", undefined)
        .setValueFromSource(new Variant({ dataType: DataType.DateTime, value: new Date(0) }));
    ns.addAnalogDataItem({
        componentOf: top, browseName: "Speed", nodeId: "s=Scout/Speed",
        dataType: "Double", engineeringUnits: standardUnits.revolutions_per_minute,
        engineeringUnitsRange: { low: 0, high: 3000 },
        value: new Variant({ dataType: DataType.Double, value: 1200 }),
    });
    variable(top, "Scout/Blob", "Blob", DataType.ByteString, Buffer.from([1, 2]));
    variable(top, "Scout/Text", "Text", DataType.LocalizedText,
        new LocalizedText({ text: "hi", locale: "en" }));
    variable(top, "Scout/Build", "Build", "BuildInfo", undefined);

    /* How many continuation points the server holds, and how many
     * Browse requests it has refused as too big. */
    ns.addVariable({
        componentOf: top, browseName: "Refused", nodeId: "s=Scout/Refused",
        dataType: DataType.UInt32, minimumSamplingInterval: 100,
        value: { get: () => new Variant({ dataType: DataType.UInt32, value: refused }) },
    });
    ns.addVariable({
        componentOf: top, browseName: "OpenCPs", nodeId: "s=Scout/OpenCPs",
        dataType: DataType.UInt32, minimumSamplingInterval: 100,
        value: {
            get: () => new Variant({
                dataType: DataType.UInt32,
                value: Object.values(server.engine._sessions || {})
                    .map(s => s.continuationPointManager?._map?.size || 0)
                    .reduce((x, y) => x + y, 0),
            }),
        },
    });
}

function plant (space, ns, size) {
    const top = ns.addFolder(space.rootFolder.objects, { browseName: "Plant", nodeId: "s=Plant" });
    const pad = n => String(n).padStart(2, "0");
    let made = 0;
    for (let area = 0; made < size; area++) {
        const ap = `Plant/Area${pad(area)}`;
        const af = ns.addFolder(top, { browseName: `Area${pad(area)}`, nodeId: `s=${ap}` });
        for (let line = 0; line < 10 && made < size; line++) {
            const lp = `${ap}/Line${pad(line)}`;
            const lf = ns.addFolder(af, { browseName: `Line${pad(line)}`, nodeId: `s=${lp}` });
            for (let cell = 0; cell < 10 && made < size; cell++) {
                const cp = `${lp}/Cell${pad(cell)}`;
                const cf = ns.addFolder(lf, { browseName: `Cell${pad(cell)}`, nodeId: `s=${cp}` });
                for (let k = 0; k < 50 && made < size; k++, made++) {
                    const signal = SIGNALS[k % SIGNALS.length];
                    const name = `${signal}_${pad(k)}`;
                    const [dataType, value] = TYPES[k % TYPES.length];
                    ns.addVariable({
                        componentOf: cf, browseName: name, nodeId: `s=${cp}/${name}`,
                        dataType, minimumSamplingInterval: 0,
                        description: `${signal} ${k} of cell ${cell}, line ${line}, area ${area}`,
                    }).setValueFromSource(new Variant({ dataType, value }));
                }
            }
        }
    }
}

module.exports = { build, operation_limits };
