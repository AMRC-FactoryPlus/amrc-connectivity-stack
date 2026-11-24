/*
 * ACS service setup
 * Tests for the Keycloak "Remember me" realm settings
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { remember_me_from } from "../lib/openid.js";

test("both lengths set turns Remember me on with those lengths", () => {
    assert.deepEqual(remember_me_from({
        OPENID_REMEMBER_ME_IDLE: "604800",
        OPENID_REMEMBER_ME_MAX: "2592000",
    }), {
        rememberMe: true,
        ssoSessionIdleTimeoutRememberMe: 604800,
        ssoSessionMaxLifespanRememberMe: 2592000,
    });
});

test("missing, empty or bad lengths turn Remember me off", () => {
    const off = { rememberMe: false };
    assert.deepEqual(remember_me_from({}), off);
    assert.deepEqual(remember_me_from({
        OPENID_REMEMBER_ME_IDLE: "", OPENID_REMEMBER_ME_MAX: "",
    }), off);
    assert.deepEqual(remember_me_from({
        OPENID_REMEMBER_ME_IDLE: "600", OPENID_REMEMBER_ME_MAX: "0",
    }), off);
    assert.deepEqual(remember_me_from({
        OPENID_REMEMBER_ME_IDLE: "soon", OPENID_REMEMBER_ME_MAX: "600",
    }), off);
});
