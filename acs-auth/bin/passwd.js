#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Password hashing tool
 * Copyright 2022 AMRC
 */

import { pbkdf2Sync, randomBytes } from "node:crypto";

const [, , password, explicit_salt] = process.argv;

const algo = "PBKDF2";
const hash_func = "sha512";
const iter = 100000;
const salt = explicit_salt != null
    ? Buffer.from(explicit_salt, "base64")
    : randomBytes(16);
const keylen = 64;

const hash = pbkdf2Sync(
    password, salt, iter, keylen, hash_func);

console.log([
    algo, hash_func, iter,
    salt.toString("base64"),
    hash.toString("base64")
].join("$"));
