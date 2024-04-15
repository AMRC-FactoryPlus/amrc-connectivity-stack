const path = require("path");
const webpack = require("webpack");

module.exports = {
    context: path.resolve(__dirname, "src/js"),
    entry: {
        webpack:    "./webpack.js",
        preact:     "./preact.js",
        configdb:   { 
            import:     "./configdb.js",
        },
        alerts:     {
            import:     "./alerts.js",
        },
    },
    output: {
        library: ["AMRC_FactoryPlus", "[name]"],
        path: path.resolve("public/js"),
        filename: "[name].js",
        chunkFilename: "webpack/[id].[name].js",
    },
    mode: "development",

    /* Polyfills for node builtins */
    resolve: {
        conditionNames: ["node", "browser", "import", "default"],
        mainFields: ["main", "module"],
        alias: {
            got: false,
            ["got-fetch"]: false,
            ["gssapi.js"]: false,
            ["timers/promises"]: "timers-promises",
            ["@amrc-factoryplus/utilities"]: "@amrc-factoryplus/service-client",
            //rxjs: path.resolve(__dirname, "src/compat/rxjs.js"),
            //immutable: path.resolve(__dirname, "src/compat/immutable.js"),
        },
        fallback: {
            buffer: require.resolve("buffer/"),
            url: require.resolve("url/"),
            util: require.resolve("util/"),
            process: require.resolve("process/browser.js"),
        },
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ["buffer", "Buffer"],
            process: "process/browser.js",
        }),
    ],
};
