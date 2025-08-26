/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from "@amrc-factoryplus/service-client";


class DeploymentChartsMigration {
    constructor(ss) {
        this.ss = ss;
        this.fplus = ss.fplus;
        this.cdb = ss.fplus.ConfigDB;
        this.log = ss.fplus.debug.bound("deployment-charts");
    }

    async run() {
        this.log("Starting Edge Deployment charts migration");

        // Get all Edge Deployment entries
        const deployments = await this.cdb.get_all_configs(UUIDs.App.EdgeAgentDeployment);

        this.log("Found %d Edge Deployment entries", deployments.size);

        // Process each deployment
        let updated = 0;
        for (const [uuid, deployment] of deployments.entries()) {

            // Check if it has a charts array with exactly one element
            if (Array.isArray(deployment.charts) && deployment.charts.length === 1) {
                this.log("Migrating deployment %s - converting charts: [%s] to chart: %s",
                    uuid, deployment.charts[0], deployment.charts[0]);

                // Create a new deployment object with chart instead of charts
                const newDeployment = { ...deployment };
                newDeployment.chart = deployment.charts[0];
                delete newDeployment.charts;

                // Update the deployment in the ConfigDB
                await this.cdb.put_config(UUIDs.App.EdgeAgentDeployment, uuid, newDeployment);
                updated++;
            } else if (Array.isArray(deployment.charts)) {
                this.log("Skipping deployment %s - has %d charts", uuid, deployment.charts.length);
            } else if (deployment.chart) {
                this.log("Skipping deployment %s - already has chart property", uuid);
            } else {
                this.log("Skipping deployment %s - no charts or chart property", uuid);
            }
        }

        this.log("Migration complete. Updated %d deployments", updated);
    }
}

export function migrate_deployment_charts(ss) {
    return new DeploymentChartsMigration(ss).run();
}
