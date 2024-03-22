/*
 * Factory+ visualisation.
 * Main web entry point.
 * Copyright 2022 AMRC.
 */

import MQTTClient from "./mqttclient.js";
import Vis from "./vis.js";
import Icons from "./icons.js";
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
            mqtt.on("graph", vis.reset_graph.bind(vis));
            mqtt.on("schema", u => icons.request_icon(u));
            mqtt.run();
        }
    }

    async build_clients (opts, graph) {
        const directories = opts.directory.split(/\s+/);
        const { username, password } = opts;

        return Promise.all(directories.map(async directory_url => { 
            const fplus = await new FactoryPlus.ServiceClient({
                directory_url, username, password,
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

        if (directory.value == "") {
            const here = new URL(document.baseURI);
            here.host = here.host.replace(/^[^.]*/, "directory");
            directory.value = here.toString();
        }

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

        this.clear_creds();
        await this.stop_vis();
        this.run();
    }

    async run () {
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
