#!/usr/bin/env node

import { Admin }    from "../lib/admin.js";

console.log("ACS Admin interface");

new Admin({ env: process.env }).init()
    .then(a => a.run());

