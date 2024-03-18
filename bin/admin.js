#!/usr/bin/env node

import express      from "express";
import { engine }   from "express-handlebars";

console.log("ACS Admin interface");

const acs = {
    domain:     process.env.EXTERNAL_DOMAIN,
    http:       process.env.SECURE ? "https" : "http",
};

const app = express();

app.engine("handlebars", engine());
app.set("view engine", "handlebars");
app.set("views", "./views");

app.get("/", (req, res) => res.render("index", {
    acs,
    page: { title: "Admin" },
}));

app.listen(process.env.PORT);
console.log(`Listening on port ${process.env.PORT}`);
