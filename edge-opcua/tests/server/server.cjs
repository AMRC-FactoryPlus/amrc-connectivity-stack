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
 *
 * It prints READY once it is listening. */

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
        automaticallyAcceptUnknownCertificate: true,
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
        serverCapabilities: { maxSessions: 500 },
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

    await server.start();
    console.log("READY");
    const stop = async () => { await server.shutdown(0); process.exit(0); };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
})().catch(e => { console.error(e); process.exit(1); });
