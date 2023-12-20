/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * App startup
 * Copyright 2023 AMRC
 */

import { ServiceClient, WebAPI } from "@amrc-factoryplus/utilities";

import { Clusters }     from "./clusters.js";
import { GIT_VERSION }  from "./git-version.js";
import { EdgeDeploy }   from "./edge-deploy.js";
import { Edge }         from "./uuids.js";

export class App {
    constructor (env) {
        const fplus = this.fplus = new ServiceClient({
            env,
            permission_group:   Edge.Perm.All,
            git_checkouts:      env.GIT_CHECKOUTS_DIR,
            git_email:          env.GIT_EMAIL,
        });

        this.clusters = new Clusters({
            fplus,
            realm:              env.REALM,
        });

        this.edge = new EdgeDeploy({
            fplus,
            realm:      env.REALM,
            http_url:   env.HTTP_API_URL,
            cert_dir:   env.KUBESEAL_TEMP,
        });

        this.api = new WebAPI({
            http_port:  env.PORT,
            realm:      env.REALM,
            hostname:   env.HOSTNAME,
            keytab:     env.SERVER_KEYTAB,

            ping: {
                service:    Edge.Service.EdgeDeployment,
                version:    "0.0.1",
                software:   {
                    vendor:         "AMRC",
                    application:    "acs-edge-deployment",
                    revision:       GIT_VERSION,
                },
            },
            routes: app => {
                app.use("/v1", this.edge.routes);
            },
        });
    }

    async init () {
        await this.fplus.init();
        await this.clusters.init();
        await this.edge.init();
        await this.api.init();
        return this;
    }

    run () {
        this.api.run();
        this.clusters.run();
    }
}
