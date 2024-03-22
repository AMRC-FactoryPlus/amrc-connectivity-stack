/* ACS service setup
 * Job control object
 * Copyright 2023 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { setup_clusters }       from "./clusters.js";
import { load_dumps }           from "./dumps.js";
import { fixups }               from "./fixups.js";
import { setup_helm }           from "./helm.js";
import { setup_manager }        from "./manager.js";

export class ServiceSetup {
    constructor (opts) {
        this.config = JSON.parse(opts.env.SS_CONFIG);
        this.acs_config = JSON.parse(opts.env.ACS_CONFIG);
        this.checkouts = opts.env.GIT_CHECKOUTS;

        this.fplus = new ServiceClient({ env: opts.env });
        this.log = this.fplus.debug.bound("setup");

        this.log("Service setup config: %o", this.config);
        this.log("ACS config: %o", this.acs_config);
    }

    async init () {
        const { fplus } = this;

        await fplus.init();
        const princ = await fplus.Auth.find_principal();
        this.email = princ.kerberos;

        return this;
    }

    async run () {
        this.log("Running fixups");
        await fixups(this);

        this.log("Loading service dump files");
        await load_dumps(this);

        this.log("Creating Helm chart templates");
        const helm = await setup_helm(this);

        this.log("Creating edge cluster objects");
        await setup_clusters(this, helm);

        this.log("Creating Manager config");
        await setup_manager(this, helm);

        this.log("Finished setup");
    }
}
