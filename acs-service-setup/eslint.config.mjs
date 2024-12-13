import globals from "globals";
import js from "@eslint/js";

export default [
    js.configs.recommended,

    {
        languageOptions: {
            globals: {
                ...globals.node,
            },

            ecmaVersion: "latest",
            sourceType: "module",
        },

        rules: {
            "no-unreachable": "warn",
            "no-unused-vars": ["warn", {
                args:           "none",
                caughtErrors:   "none",
            }],
            "no-fallthrough": "off",                
        },
    },
];
