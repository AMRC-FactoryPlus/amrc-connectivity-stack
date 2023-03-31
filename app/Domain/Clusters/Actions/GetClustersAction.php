<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Clusters\Actions;

use App\Domain\Clusters\Models\Cluster;

use function func_get_args;

class GetClustersAction
{
    public function execute()
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        return action_success(Cluster::all());
    }

    /**
     * This action
     **/
    private function authorise()
    {
    }

    private function validate()
    {
    }
}
