#!/usr/bin/env node

/*
 * Factory+ visualiser.
 * Web server.
 * Copyright 2022 AMRC.
 */

import express from "express";

const app = express();
app.use(express.static("public", {
    maxAge: "1d",
}));

app.listen(process.env.PORT ?? 80);
