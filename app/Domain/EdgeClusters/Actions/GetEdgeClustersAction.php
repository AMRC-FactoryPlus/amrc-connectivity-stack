<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\EdgeClusters\Actions;

use AMRCFactoryPlus\ServiceClient;
use App\Exceptions\ActionForbiddenException;
use AMRCFactoryPlus\UUIDs\App;

use function func_get_args;

class GetEdgeClustersAction
{

    /**
     * This action
     **/

    private function authorise()
    {
        if ((!auth()->user()->administrator)) {
            throw new ActionForbiddenException('You do not have permission to view remote clusters.');
        }
    }

    private function validate()
    {
    }

    public function execute()
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $fplus = resolve(ServiceClient::class);
        $configDB = $fplus->getConfigDB();
        $edgeClusters = $configDB->getConfig(App::EdgeClusterStatus);

        $clusters = [];

        // Iterate through the edge clusters
        foreach ($edgeClusters as $cluster) {
            // Then hit the general object information endpoint for each cluster to get its name
            $clusterName = $configDB->getConfig(App::Info, $cluster)['name'];
            // Then hit the edge cluster status endpoint for each cluster to get its status and nodes
            $clusterResponse = $configDB->getConfig(App::EdgeClusterStatus, $cluster);

            $clusters[$clusterName] = [
                'uuid' => $cluster,
                'nodes' => $clusterResponse['hosts'],
            ];
        }

        return action_success($clusters);
    }

}
