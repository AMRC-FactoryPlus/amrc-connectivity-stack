/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import util from "util";

import * as dotenv from 'dotenv'
dotenv.config();

/**
 * Convenience function which logs a message to the console along with the calling function, file, and line number
 * Do not use in production!
 * @param {string} msg Message to print to console
 */
export function log(msg: String) {
    if (process.env.DEBUG == "true") {
        const stack = (new Error()).stack;
        if (typeof stack !== "undefined") {
            const split = stack.split("\n")[2].split('/').pop();
            if (typeof split !== "undefined") {
                const caller = split.replace(')', '');
                console.log(`DEBUG [${(new Date).toISOString()}] ${caller} --> ${msg}`);
            }
        }
    }
}

export function logf (fmt, ...args) {
    log(util.format(fmt, ...args));
}
