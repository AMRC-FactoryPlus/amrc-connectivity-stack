/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import timers from "timers/promises";

import { ServiceClient } from "@amrc-factoryplus/service-client";

import { migrate_auth_groups }  from "./auth-group.js";
import { DumpLoader }           from "./dumps.js";
import { fixups }               from "./fixups.js";
import { setup_git_repos }      from "./git-repos.js";
import { setup_local_uuids }    from "./local-uuids.js";
import {migrate_edge_agent_config} from "./manager-devices.js";
import {migrate_deployment_charts} from "./deployment-charts.js";

export class ServiceSetup {
    constructor (opts) {
        this.config = JSON.parse(opts.env.SS_CONFIG);
        this.acs_config = JSON.parse(opts.env.ACS_CONFIG);
        this.checkouts = opts.env.GIT_CHECKOUTS;

        this.fplus = new ServiceClient({ env: opts.env });
        this.log = this.fplus.debug.bound("setup");
        this.dumps = new DumpLoader({
            fplus:      this.fplus,
            acs_config: this.acs_config,
            dumps:      "dumps",
            log:        this.fplus.debug.bound("dump"),
        });

        this.log("Service setup config: %o", this.config);
        this.log("ACS config: %o", this.acs_config);
    }

    async init () {
        const { fplus } = this;

        await fplus.init();

        return this;
    }

    async wait_for (service, version) {
        this.log("Waiting for %s (%s)", service.service, version);
        while (!await service.version_satisfies(version)) {
            this.log("Service not ready, waiting 3s");
            await timers.setTimeout(3000);
        }
        this.log("Service %s ready", service.service);
    }

    async run () {
        const { fplus } = this;

        await this.wait_for(fplus.Directory, "1.1.0");

        this.log("Loading early dumps");
        await this.dumps.load_dumps(true);

        await this.wait_for(fplus.Auth, "2.0.0");
        await this.wait_for(fplus.ConfigDB, "2.0.0");

        this.log("Creating local UUIDs");
        const local = await setup_local_uuids(this);
        this.dumps.set_local_uuids(local);

        this.log("Running fixups");
        await fixups(this, local);

        this.log("Loading service dump files");
        await this.dumps.load_dumps(false);

        this.log("Creating shared git repositories");
        await setup_git_repos(this, local);

        this.log("Migrating managed edge agent config");
        await migrate_edge_agent_config(this);

        this.log("Migrating legacy Auth groups");
        await migrate_auth_groups(this);

        this.log("Migrating Edge Deployment charts");
        await migrate_deployment_charts(this);

        this.log("Finished setup");
    }
}
