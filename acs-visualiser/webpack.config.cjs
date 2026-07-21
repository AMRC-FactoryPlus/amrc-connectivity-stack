const path = require("path");
const webpack = require("webpack");

module.exports = {
    entry: "./lib/webpack.js",
    output: {
        library: "AMRC_FactoryPlus_Vis",
        path: path.resolve("public"),
        filename: "webpack-modules.js",
        chunkFilename: "webpack/[id].[name].js",
    },
    mode: "development",

    /* Polyfills for node builtins. Node-only modules are stubbed to
     * false: the service-client only loads them via guarded dynamic
     * imports (GSS, got, files upload) which fall back cleanly in the
     * browser. */
    resolve: {
        alias: {
            got: false,
            ["got-fetch"]: false,
            ["gssapi.js"]: false,
            ["@amrc-factoryplus/gssapi"]: false,
            rxjs: false,
            ["timers/promises"]: "timers-promises",
            ["@amrc-factoryplus/sparkplug-app"]: false,
        },
        fallback: {
            buffer: require.resolve("buffer/"),
            url: require.resolve("url/"),
            util: require.resolve("util/"),
            fs: false,
            path: false,
            stream: false,
            ["stream/promises"]: false,
            async_hooks: false,
        },
    },
    plugins: [
        /* Strip the node: scheme so the aliases above apply. */
        new webpack.NormalModuleReplacementPlugin(/^node:/,
            res => { res.request = res.request.replace(/^node:/, ""); }),
        new webpack.ProvidePlugin({
            Buffer: ["buffer", "Buffer"],
            process: "process/browser",
        }),
    ],
};
