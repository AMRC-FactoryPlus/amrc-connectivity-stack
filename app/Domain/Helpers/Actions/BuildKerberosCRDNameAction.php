<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Helpers\Actions;

use function func_get_args;

class BuildKerberosCRDNameAction
{

    /**
     * This action builds a Kerberos CRD name for a given group, hostname and node ID
     **/

    public function execute($group, $hostname, $nodeId)
    {

        $prefix = 'sg' . $group->cluster->id;
        // If we have a hostname then this is a Cell Gateway
        if ($hostname) {
            $prefix = 'nd' . $group->cluster->id;
        }

        return action_success($prefix . '-' . strtolower($group->name) . '-' . strtolower($nodeId));
    }

}
