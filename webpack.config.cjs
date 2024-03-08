const path = require("path");
const webpack = require("webpack");

module.exports = {
    entry: "./lib/webpack.js",
    output: {
        library: "AMRC_FactoryPlus_Vis",
        path: path.resolve("public"),
        filename: "webpack-modules.js",
    },
    mode: "development",

    /* Polyfills for node builtins */
    resolve: {
        alias: {
            got: false,
            ["got-fetch"]: false,
            ["gssapi.js"]: false,
            rxjs: false,
            ["timers/promises"]: "timers-promises",
            ["@amrc-factoryplus/sparkplug-app"]: false,
        },
        fallback: {
            buffer: require.resolve("buffer/"),
            url: require.resolve("url/"),
            util: require.resolve("util/"),

        },
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ["buffer", "Buffer"],
            process: "process/browser",
        }),
    ],
};
