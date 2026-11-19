/*
 * ACS OPC UA driver
 * A node-opcua server for the driver's integration tests
 * Copyright 2026 University of Sheffield
 */

/* node server.cjs <port> <pki dir>
 *
 * node-opcua is the library the Edge Agent's built-in OPC UA
 * connection uses. Run with NODE_PATH pointing at a node_modules that
 * has it (acs-edge's). It offers every security mode and policy, the
 * user `test` with password `testpass` as well as anonymous, and one
 * writable node of each type under ns=1;s=T/<type>, plus:
 *
 *   ns=1;s=T/ReadOnly   a Double the client can't write
 *   ns=1;s=T/Bad        a Double with status BadDeviceFailure
 *   ns=1;s=T/Counter    a UInt32 that counts up every 100 ms
 *   ns=1;s=T/Step       an Int32, 0, which SIGUSR2 adds 1 to
 *   ns=1;s=T/Temps      a Double array [10.5, 11.5, ... 15.5]
 *   ns=1;s=T/Grid       a 2x3 Int32 matrix [[1, 2, 3], [4, 5, 6]]
 *   ns=1;s=T/Counts     a UInt32 array [7, n, 7], n counting up every
 *                       100 ms
 *   ns=1;s=T/Elem       an Int32 array [0, 1, 2, 3]
 *   ns=1;s=T/Elem[3]    an Int32 node of its own, 99
 *
 * Settings from the environment, for particular tests:
 *
 *   SKEW_MS             the server's clock is this far out
 *   LATE_MS             ns=1;s=T/Late (Int32 42) only appears this long
 *                       after start, as on a PLC whose program loads
 *                       after its server starts
 *   BULK                that many Doubles ns=1;s=B/<i>, all changing
 *                       every 100 ms
 *   BULK_BYTES          make them Strings this long instead
 *   ITEMS_PER_CALL      MaxMonitoredItemsPerCall
 *   SUBS_PER_SESSION    MaxSubscriptionsPerSession
 *   REJECT_CLIENTS      don't trust a client certificate it hasn't seen,
 *                       but put it in <pki dir>/server/rejected, as a
 *                       server set up by hand does
 *
 * It prints READY once it is listening. */

/* SKEW_MS puts this server's clock that far out, as a PLC on local
 * summer time is. It must be set before node-opcua loads. */
const skew = Number(process.env.SKEW_MS || 0);
if (skew) {
    const RealDate = Date;
    global.Date = class extends RealDate {
        constructor (...a) { if (a.length) super(...a); else super(RealDate.now() + skew); }
        static now () { return RealDate.now() + skew; }
    };
}

const path = require("path");
const {
    OPCUAServer, OPCUACertificateManager, DataType, Variant, VariantArrayType,
    StatusCodes, SecurityPolicy, MessageSecurityMode, LocalizedText,
} = require("node-opcua");

const port = Number(process.argv[2]);
const pki = process.argv[3];

const Types = {
    Boolean:        [DataType.Boolean, true],
    SByte:          [DataType.SByte, -5],
    Byte:           [DataType.Byte, 200],
    Int16:          [DataType.Int16, -300],
    UInt16:         [DataType.UInt16, 60000],
    Int32:          [DataType.Int32, -70000],
    UInt32:         [DataType.UInt32, 4000000000],
    Int64:          [DataType.Int64, [0x7fffffff, 0xffffffff]],
    UInt64:         [DataType.UInt64, [0xffffffff, 0xfffffffe]],
    Float:          [DataType.Float, 1.1],
    Double:         [DataType.Double, 2.2],
    String:         [DataType.String, "hello"],
    DateTime:       [DataType.DateTime, new Date(1763380800123)],
    Guid:           [DataType.Guid, "72962B91-FA75-4AE6-8D28-B404DC7DAF63"],
    ByteString:     [DataType.ByteString, Buffer.from([1, 2, 3])],
    LocalizedText:  [DataType.LocalizedText, new LocalizedText({ text: "txt", locale: "en" })],
};

(async () => {
    const certs = new OPCUACertificateManager({
        rootFolder: path.join(pki, "server"),
        automaticallyAcceptUnknownCertificate: !process.env.REJECT_CLIENTS,
    });
    await certs.initialize();

    const server = new OPCUAServer({
        port,
        hostname: "127.0.0.1",
        securityModes: [
            MessageSecurityMode.None, MessageSecurityMode.Sign,
            MessageSecurityMode.SignAndEncrypt,
        ],
        securityPolicies: [
            SecurityPolicy.None, SecurityPolicy.Basic128Rsa15, SecurityPolicy.Basic256,
            SecurityPolicy.Basic256Sha256, SecurityPolicy.Aes128_Sha256_RsaOaep,
            SecurityPolicy.Aes256_Sha256_RsaPss,
        ],
        allowAnonymous: true,
        userManager: { isValidUser: (u, p) => u == "test" && p == "testpass" },
        serverCertificateManager: certs,
        /* Each test case drops its driver without closing its session,
         * so allow more than node-opcua's default of 10. */
        maxConnectionsPerEndpoint: 500,
        serverCapabilities: {
            maxSessions: 500,
            ...(process.env.SUBS_PER_SESSION
                ? { maxSubscriptionsPerSession: Number(process.env.SUBS_PER_SESSION) } : {}),
            ...(process.env.ITEMS_PER_CALL
                ? { operationLimits: { maxMonitoredItemsPerCall: Number(process.env.ITEMS_PER_CALL) } }
                : {}),
        },
    });
    await server.initialize();

    const space = server.engine.addressSpace;
    const ns = space.getOwnNamespace();
    const folder = ns.addFolder(space.rootFolder.objects, { browseName: "T" });
    const variable = (name, dataType, opts = {}) => ns.addVariable({
        componentOf: folder, browseName: name, nodeId: `s=T/${name}`,
        dataType, minimumSamplingInterval: 0,
        accessLevel: "CurrentRead | CurrentWrite",
        userAccessLevel: "CurrentRead | CurrentWrite",
        ...opts,
    });

    for (const [name, [dataType, value]] of Object.entries(Types))
        variable(name, dataType).setValueFromSource(
            new Variant({ dataType, arrayType: VariantArrayType.Scalar, value }));

    variable("DoubleArray", DataType.Double, { valueRank: 1 }).setValueFromSource(
        new Variant({ dataType: DataType.Double, arrayType: VariantArrayType.Array, value: [1.5, 2.5] }));
    /* Arrays for addresses with an index: a writable Double array, a
     * 2x3 Int32 matrix, an array whose element 1 counts up every
     * 100 ms, and an Int32 array T/Elem beside a scalar node whose own
     * id is T/Elem[3], as PLCs name array elements. */
    variable("Temps", DataType.Double, { valueRank: 1, arrayDimensions: [6] }).setValueFromSource(
        new Variant({ dataType: DataType.Double, arrayType: VariantArrayType.Array,
            value: [10.5, 11.5, 12.5, 13.5, 14.5, 15.5] }));
    variable("Grid", DataType.Int32, { valueRank: 2, arrayDimensions: [2, 3] }).setValueFromSource(
        new Variant({ dataType: DataType.Int32, arrayType: VariantArrayType.Matrix,
            dimensions: [2, 3], value: [1, 2, 3, 4, 5, 6] }));
    variable("Elem", DataType.Int32, { valueRank: 1 }).setValueFromSource(
        new Variant({ dataType: DataType.Int32, arrayType: VariantArrayType.Array,
            value: [0, 1, 2, 3] }));
    variable("Elem[3]", DataType.Int32).setValueFromSource(
        new Variant({ dataType: DataType.Int32, value: 99 }));
    const counts = variable("Counts", DataType.UInt32, { valueRank: 1 });
    let c = 0;
    const setCounts = () => counts.setValueFromSource(new Variant({
        dataType: DataType.UInt32, arrayType: VariantArrayType.Array, value: [7, c++, 7] }));
    setCounts();
    setInterval(setCounts, 100);

    variable("Bad", DataType.Double).setValueFromSource(
        new Variant({ dataType: DataType.Double, value: 3 }), StatusCodes.BadDeviceFailure);
    variable("ReadOnly", DataType.Double, {
        accessLevel: "CurrentRead", userAccessLevel: "CurrentRead",
    }).setValueFromSource(new Variant({ dataType: DataType.Double, value: 4 }));

    const counter = variable("Counter", DataType.UInt32);
    let n = 0;
    counter.setValueFromSource(new Variant({ dataType: DataType.UInt32, value: n }));
    setInterval(() => counter.setValueFromSource(
        new Variant({ dataType: DataType.UInt32, value: ++n })), 100);

    const step = variable("Step", DataType.Int32);
    let steps = 0;
    step.setValueFromSource(new Variant({ dataType: DataType.Int32, value: 0 }));
    process.on("SIGUSR2", () => step.setValueFromSource(
        new Variant({ dataType: DataType.Int32, value: ++steps })));

    const late = Number(process.env.LATE_MS || 0);
    if (late)
        setTimeout(() => variable("Late", DataType.Int32).setValueFromSource(
            new Variant({ dataType: DataType.Int32, value: 42 })), late);

    const bulk = [];
    const bytes = Number(process.env.BULK_BYTES || 0);
    const bulkType = bytes ? DataType.String : DataType.Double;
    for (let i = 0; i < Number(process.env.BULK || 0); i++)
        bulk.push(ns.addVariable({
            componentOf: folder, browseName: `B${i}`, nodeId: `s=B/${i}`,
            dataType: bulkType, minimumSamplingInterval: 0,
        }));
    let b = 0;
    if (bulk.length)
        setInterval(() => {
            b++;
            const value = bytes ? `${b} `.padEnd(bytes, "x") : b;
            for (const v of bulk)
                v.setValueFromSource(new Variant({ dataType: bulkType, value }));
        }, 100);

    await server.start();
    console.log("READY");
    const stop = async () => { await server.shutdown(0); process.exit(0); };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
})().catch(e => { console.error(e); process.exit(1); });
