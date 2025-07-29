#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import { RxClient }         from "@amrc-factoryplus/rx-client";
import k8s                  from "@kubernetes/client-node";

import { GIT_VERSION } from "../lib/git-version.js";
import { Edge } from "../lib/uuids.js";

import { Deployments } from "../lib/deployments.js";
import { Kubeseal } from "../lib/kubeseal.js";
import { Nodes } from "../lib/nodes.js";

const cluster = process.env.CLUSTER_UUID;

const fplus = await new RxClient({
    env:                process.env,
    permission_group:   Edge.Perm.All,
}).init();
fplus.debug.log("version", "Starting Edge Sync agent, version %s", GIT_VERSION);

const kubeconfig = new k8s.KubeConfig();
kubeconfig.loadFromDefault();
const namespace = kubeconfig
    .getContextObject(kubeconfig.currentContext)
    .namespace;

const nodes = await new Nodes({
    fplus, cluster, kubeconfig, namespace,
}).init();

const kubeseal = await new Kubeseal({
    fplus, cluster,
    namespace:      process.env.SEALED_SECRETS_NAMESPACE,
    controller:     process.env.SEALED_SECRETS_CONTROLLER,
}).init();

const deploy = await new Deployments({
    fplus, kubeconfig, namespace, cluster,
    values: {
        cluster:        process.env.CLUSTER_NAME,
        realm:          process.env.REALM,
        directory_url:  process.env.DIRECTORY_URL,
    },
}).init();

nodes.run();
kubeseal.run();
deploy.run();
