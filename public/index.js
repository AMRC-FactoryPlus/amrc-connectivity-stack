/*
 * Factory+ visualisation.
 * Main web entry point.
 * Copyright 2022 AMRC.
 */

import MQTTClient from "./mqttclient.js";
import Vis from "./vis.js";
import Icons from "./icons.js";

class FPlusVis {
    start_vis (opts) {
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

        const mqtt = this.mqtt = new MQTTClient({
            name: "Factory+",
            icons: this.icons,
            ...opts,
        }).run();

        const vis = this.vis = new Vis(mqtt.graph, canvas, this.icons).run();

        mqtt.on("packet", vis.make_active.bind(vis));
        mqtt.on("graph", vis.reset_graph.bind(vis));
    }

    async stop_vis () {
        await this.vis.stop();
        await this.mqtt.stop();
        this.canvas.style.display = "none";
    }

    save_creds (creds) {
        console.log("Saving to localStorage");
        try {
            localStorage.setItem("broker", creds.broker);
            localStorage.setItem("username", creds.username);
            localStorage.setItem("password", creds.password);
        }
        catch (e) {
            console.log(`LocalStorage failed: ${e}`);
        }
    }

    load_creds () {
        const [broker, username, password] =
            ["broker", "username", "password"]
                .map(n => localStorage.getItem(n));

        if (broker && username && password) {
            return { broker, username, password };
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
        const [broker, user, passwd, save, login] =
            ["broker", "username", "password", "save", "login"]
                .map(n => document.getElementById(n));

        if (broker.value == "")
            broker.value = "wss://mqtt.BASE_URL";

        return new Promise((resolve, reject) => {
            login.addEventListener("click", () => {
                const creds = {
                    broker: broker.value,
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
        this.icons = new Icons();
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
