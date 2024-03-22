<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\EdgeClusters\Actions;

use AMRCFactoryPlus\ServiceClient;

use function func_get_args;

class GetBootstrapScriptForEdgeClusterAction
{

    /**
     * This action gets the bootstrap script for a given edge cluster
     **/

    private function authorise() {}

    private function validate() {}

    public function execute(string $cluster)
    {

        $fplus = resolve(ServiceClient::class);

        return action_success($fplus->getClusterManager()->getBootstrapScript($cluster));
    }

}
