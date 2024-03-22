<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\SensitiveInformation\Actions;

use AMRCFactoryPlus\ServiceClient;
use Ramsey\Uuid\Uuid;

class StoreSensitiveInformationAction
{

    /**
     * This action stores sensitive information on the remote cluster by way of sending the information to the
     * cluster-manager component that ultimately seals the information using the public key of the target cluster.
     * The safe identifier is then returned to the caller to use.
     **/

    public function execute(string $cluster, string $node, string $namespace, string $value)
    {
        $fplus = resolve(ServiceClient::class);
        $clusterManager = $fplus->getClusterManager();

        // Forward the sensitive information to the cluster manager to seal and deploy to the edge

        // Generate a UUID to use as the object identifier
        $identifier = '__FPSI__' . Uuid::uuid4();

        $clusterManager->putSecret(
            cluster: $cluster,
            namespace: $namespace,
            name: 'edge-agent-sensitive-information-'. $node ,
            key: $identifier,
            payload: $value
        );

        return action_success($identifier);
    }

}
