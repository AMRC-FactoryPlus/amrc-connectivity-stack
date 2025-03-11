/* ACS service setup
 * Job control object
 * Copyright 2023 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/service-client";

import { migrate_auth_groups }  from "./auth-group.js";
import { setup_clusters }       from "./clusters.js";
import { DumpLoader }           from "./dumps.js";
import { fixups }               from "./fixups.js";
import { setup_helm }           from "./helm.js";
import { setup_manager }        from "./manager.js";
import { service_sp_addrs }     from "./sp-addrs.js";

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

    async run () {
        this.log("Loading directory dump");
        await this.dumps.load_dumps(true);

        this.log("Running fixups");
        await fixups(this);

        this.log("Loading service dump files");
        await this.dumps.load_dumps(false);

        this.log("Setting legacy service Sparkplug addresses");
        await service_sp_addrs(this);

        this.log("Migrating legacy Auth groups");
        await migrate_auth_groups(this);

        this.log("Creating Helm chart templates");
        const helm = await setup_helm(this);

        this.log("Creating edge cluster objects");
        await setup_clusters(this, helm);

        this.log("Creating Manager config");
        await setup_manager(this, helm);

        this.log("Finished setup");
    }
}
