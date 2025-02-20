/* AMRC Connectivity Stack
 * Edge Agent driver library
 * Copyright 2024 AMRC
 */

import asyncjs from "async";

import { Driver } from "./driver.js";

const Q_TIMEOUT = 30000;
const Q_MAX = 20;

export class PolledDriver extends Driver {
    constructor (opts) {
        super(opts);

        this.poller = this.createPoller(opts);
    }

    createPoller (opts) {
        const do_poll = asyncjs.timeout(this.poll.bind(this), Q_TIMEOUT);
        const err = e => e && this.pollErr(e);

        if (opts.serial) {
            const q = asyncjs.queue(do_poll);
            q.error(err);
            return a => q.length() < Q_MAX
                    /* grr stupid api */
                ? q.push([a])
                : err("Poll queue size exceeded. We're polling too fast for the device!");
        }
        else {
            return a => do_poll(a, err);
        }
    }

    pollErr (e) {
        this.log("POLL ERR: %o", e);
    }

    setupMessageHandlers () {
        super.setupMessageHandlers();
        this.message("poll", p => {
            const topics = p.toString().split("\n");
            this.log("POLL %O", topics);

            if (!this.poller) {
                this.log("Can't poll, no poller!");
                return;
            }
            this.poller(topics);
        });
    }

    async poll (topics) {
        if (!this.addrs) {
            this.log("Can't poll, no addrs! Is the device config invalid?");
            return;
        }

        const specs = topics
            .map(t => ({
                data: this.topic("data", t),
                spec: this.addrs.get(t),
            }))
            .filter(v => v.spec);

        for (const {data, spec} of specs) {
            this.log("READ %O", spec);
            const buf = await this.handler.poll(spec);

            this.log("DATA %O", buf);
            if (buf)
                await this.mqtt.publishAsync(data, buf);
        }
    }
}
