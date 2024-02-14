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
        fallback: {
            buffer: require.resolve("buffer/"),
            url: require.resolve("url/"),
        },
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ["buffer", "Buffer"],
            process: "process/browser",
        }),
    ],
};
