/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * App startup
 * Copyright 2023 AMRC
 */

import { RxClient }     from "@amrc-factoryplus/rx-client";
import { WebAPI }       from "@amrc-factoryplus/service-api";      

import { Clusters }     from "./clusters.js";
import { GIT_VERSION }  from "./git-version.js";
import { EdgeDeploy }   from "./edge-deploy.js";
import { Edge }         from "./uuids.js";

export class App {
    constructor (env) {
        const fplus = this.fplus = new RxClient({
            env,
            permission_group:   Edge.Perm.All,
            git_checkouts:      env.GIT_CHECKOUTS_DIR,
            git_email:          env.GIT_EMAIL,
        });

        const clusters = this.clusters = new Clusters({
            fplus,
            krbkeys:            env.KRBKEYS_IMAGE,
            realm:              env.REALM,
            external_domain:    env.EXTERNAL_DOMAIN,
            org_prefix:         env.ORGANISATION_PREFIX,
        });

        this.edge = new EdgeDeploy({
            fplus, clusters,
            http_url:       env.HTTP_API_URL,
            external_url:   env.EXTERNAL_URL,
        });

        this.api = new WebAPI({
            http_port:  env.PORT,
            realm:      env.REALM,
            hostname:   env.HOSTNAME,
            keytab:     env.SERVER_KEYTAB,
            debug:      fplus.debug,

            ping: {
                service:    Edge.Service.EdgeDeployment,
                version:    "0.0.1",
                software:   {
                    vendor:         "AMRC",
                    application:    "acs-cluster-manager",
                    revision:       GIT_VERSION,
                },
            },
            routes: app => {
                app.use("/v1", this.edge.routes);
            },
            public: "/v1/cluster/:uuid/bootstrap",
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
