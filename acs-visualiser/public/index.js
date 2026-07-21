/*
 * Factory+ visualisation.
 * Main web entry point.
 * Copyright 2022 AMRC.
 */

import MQTTClient from "./mqttclient.js";
import Vis from "./vis.js";
import Icons from "./icons.js";
import { OidcClient } from "./oidc.js";
import { FactoryPlus } from "./webpack.js";

class FPlusVis {
    async start_vis (opts) {
        const canvas = this.canvas;
        canvas.style.display = "";
        const resize = () => {
            const h = window.innerHeight;
            const w = window.innerWidth;
            console.log("Canvas %sx%s", w, h);
            canvas.height = h * devicePixelRatio; 
            canvas.width = w * devicePixelRatio;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
        };
        window.addEventListener("resize", resize);
        resize();

        const graph = MQTTClient.graph("Factory+");
        const clients = await this.build_clients(opts, graph);
        this.clients = clients;
        window.AMRC_FactoryPlus_Vis_Clients = clients;

        const fplus = clients[0].fplus;
        const icons = await new Icons({ fplus }).init();
        const vis = this.vis = new Vis(graph, canvas, icons);

        vis.run();
        for (const { mqtt } of clients) {
            mqtt.on("packet", vis.make_active.bind(vis));
            mqtt.on("graph", vis.reset_soon.bind(vis));
            mqtt.on("schema", u => icons.request_icon(u));
            mqtt.run();
        }
    }

    async build_clients (opts, graph) {
        const directories = opts.directory.split(/\s+/);
        const { username, password, bearer_jwt } = opts;

        return Promise.all(directories.map(async directory_url => {
            const fplus = await new FactoryPlus.ServiceClient({
                directory_url, username, password, bearer_jwt,
                verbose:        "ALL",
                browser:        true,
            }).init();
            const mqtt = new MQTTClient({ fplus, graph });

            return { fplus, mqtt };
        }));
    }

    async stop_vis () {
        await this.vis.stop();
        for (const { mqtt } of this.clients) {
            await mqtt.stop();
        }
        this.canvas.style.display = "none";
    }

    save_creds (creds) {
        console.log("Saving to localStorage");
        try {
            localStorage.setItem("directory", creds.directory);
            localStorage.setItem("username", creds.username);
            localStorage.setItem("password", creds.password);
        }
        catch (e) {
            console.log(`LocalStorage failed: ${e}`);
        }
    }

    load_creds () {
        const [directory, username, password] =
            ["directory", "username", "password"]
                .map(n => localStorage.getItem(n));

        if (directory && username && password) {
            return { directory, username, password };
        }
        else {
            this.clear_creds();
            return undefined;
        }
    }

    clear_creds () {
        localStorage.clear();
    }

    login () {
        const [directory, user, passwd, save, login] =
            ["directory", "username", "password", "save", "login"]
                .map(n => document.getElementById(n));

        if (directory.value == "")
            directory.value = this.default_directory();

        return new Promise((resolve, reject) => {
            login.addEventListener("click", () => {
                const creds = {
                    directory: directory.value,
                    username: user.value,
                    password: passwd.value,
                };
                if (save.checked)
                    this.save_creds(creds);
                else
                    this.clear_creds();
                resolve(creds);
            });
        });
    }

    async keydown (ev) {
        if (ev.key != "Escape") return;

        if (this.oidc) {
            await this.stop_vis();
            this.oidc.logout();
            return;
        }

        this.clear_creds();
        await this.stop_vis();
        this.run();
    }

    default_directory () {
        const here = new URL(document.baseURI);
        here.host = here.host.replace(/^[^.]*/, "directory");
        return here.toString();
    }

    async fetch_config () {
        try {
            const res = await fetch("config.json");
            if (!res.ok) return null;
            return await res.json();
        }
        catch { return null; }
    }

    /* Log in via Keycloak. This may navigate away (to the Keycloak
     * login page, or straight back if the SSO session is alive), and
     * a `?auth_token=` JWT in our URL bypasses login entirely. */
    async oidc_login (config) {
        const oidc = await new OidcClient({
            discovery_url:  config.oidc_discovery_url,
            client_id:      config.oidc_client_id,
        }).init();
        await oidc.ensure_login();
        this.oidc = oidc;
        console.log("Logged in via OIDC as %s", oidc.username);

        return {
            directory:  config.directory_url ?? this.default_directory(),
            bearer_jwt: bad => oidc.token(bad),
        };
    }

    async run () {
        const config = await this.fetch_config();

        if (config?.oidc_discovery_url) {
            const creds = await this.oidc_login(config);
            this.start_vis(creds);
            return;
        }

        /* No OIDC configured (local dev): username/password form. */
        let creds = this.load_creds();
        if (!creds) {
            this.form.style.display = "";
            creds = await this.login();
            this.form.style.display = "none";
        }

        this.start_vis(creds);
    }

    async main () {
        this.canvas = document.getElementById("canvas");
        this.form = document.getElementById("form");
        this.canvas.style.display = "none";
        this.form.style.display = "none";
        await this.run();
        document.addEventListener("keydown", this.keydown.bind(this));
    }
}

const app = new FPlusVis();
window.addEventListener("load", app.main.bind(app));
