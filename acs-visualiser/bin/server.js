#!/usr/bin/env node

/*
 * Factory+ visualiser.
 * Web server.
 * Copyright 2022 AMRC.
 */

import express from "express";

const app = express();

/* Unset or unparseable numbers go out as null (JSON has no NaN), and
 * the frontend uses its own defaults. */
const num = v => v ? Number(v) : null;

/* Runtime configuration for the browser app. When OIDC_DISCOVERY_URL
 * is set the frontend delegates login to Keycloak; otherwise it falls
 * back to the built-in username/password form. */
app.get("/config.json", (req, res) => res.json({
    oidc_discovery_url:     process.env.OIDC_DISCOVERY_URL || null,
    oidc_client_id:         process.env.OIDC_CLIENT_ID || "visualiser",
    directory_url:          process.env.DIRECTORY_EXTERNAL_URL || null,
    idle_after:             num(process.env.IDLE_AFTER),
    idle_fade:              num(process.env.IDLE_FADE),
    idle_opacity:           num(process.env.IDLE_OPACITY),
}));

app.use(express.static("public", {
    maxAge: "1d",
}));

app.listen(process.env.PORT ?? 80);
