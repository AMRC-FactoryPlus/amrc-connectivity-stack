#!/usr/bin/env node

/*
 * Factory+ visualiser.
 * Web server.
 * Copyright 2022 AMRC.
 */

import express from "express";

const app = express();

/* Runtime configuration for the browser app. When OIDC_DISCOVERY_URL
 * is set the frontend delegates login to Keycloak; otherwise it falls
 * back to the built-in username/password form. */
app.get("/config.json", (req, res) => res.json({
    oidc_discovery_url:     process.env.OIDC_DISCOVERY_URL || null,
    oidc_client_id:         process.env.OIDC_CLIENT_ID || "visualiser",
    directory_url:          process.env.DIRECTORY_EXTERNAL_URL || null,
}));

app.use(express.static("public", {
    maxAge: "1d",
}));

app.listen(process.env.PORT ?? 80);
