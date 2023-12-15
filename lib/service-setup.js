/* ACS service setup
 * Job control object
 * Copyright 2023 AMRC
 */

import { ServiceClient } from "@amrc-factoryplus/utilities";

import { setup_helm }       from "./helm.js";
import { setup_edo }        from "./edo.js";

export class ServiceSetup {
    constructor (opts) {
        this.config = JSON.parse(opts.env.SS_CONFIG);
        this.acs_config = JSON.parse(opts.env.ACS_CONFIG);
        this.checkouts = opts.env.GIT_CHECKOUTS;

        this.fplus = new ServiceClient({ env: opts.env });
        this.log = this.fplus.debug.bound("setup");
    }

    async init () {
        const { fplus } = this;

        await fplus.init();
        const princ = await fplus.Auth.find_principal();
        this.email = princ.kerberos;

        return this;
    }

    async run () {
        const helm = await setup_helm(this);
        await setup_edo(this, helm);
    }
}
