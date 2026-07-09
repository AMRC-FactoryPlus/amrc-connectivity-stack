"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kdestroy = exports.kinit = exports.verifyCredentials = exports.setKeytabPath = exports.acceptSecContext = exports.initSecContext = exports.createServerContext = exports.createClientContext = void 0;
const gssapi = require('bindings')('node-gssapi');
function createClientContext(options) {
    if (('krbCcache' in options) && typeof options.server !== 'string') {
        throw new Error('"krbCcache" is specified, it must be a string');
    }
    if (typeof options.server !== 'string') {
        throw new Error('"server" property must be a string');
    }
    if (typeof options.mech === 'string' && !['spnego', 'krb5'].includes(options.mech)) {
        throw new Error('If "mech" is specified, it must be set to either "spnego" or "krb5"');
    }
    return new gssapi.GssSecContext(options.krbCcache || '', options.server || '', options.mech || '');
}
exports.createClientContext = createClientContext;
function createServerContext() {
    return new gssapi.GssSecContext('', '', '');
}
exports.createServerContext = createServerContext;
async function initSecContext(ctx, token) {
    if (token === undefined) {
        token = Buffer.alloc(0);
    }
    return gssapi.initSecContext(ctx, token);
}
exports.initSecContext = initSecContext;
async function acceptSecContext(ctx, token) {
    return gssapi.acceptSecContext(ctx, token);
}
exports.acceptSecContext = acceptSecContext;
function setKeytabPath(path) {
    if (typeof path !== 'string') {
        throw new Error("Keytab Path must be a string");
    }
    return gssapi.setKeytabPath(path);
}
exports.setKeytabPath = setKeytabPath;
async function verifyCredentials(username, password, options) {
    if (!options) {
        options = {};
    }
    return gssapi.verifyCredentials(username, password, options.keytab || "", options.serverPrincipal || "");
}
exports.verifyCredentials = verifyCredentials;
async function kinit(ccname, username, password) {
    return gssapi.kinit(ccname, username, password);
}
exports.kinit = kinit;
async function kdestroy(ccname) {
    return gssapi.kdestroy(ccname).then(() => { });
}
exports.kdestroy = kdestroy;
//# sourceMappingURL=index.js.map