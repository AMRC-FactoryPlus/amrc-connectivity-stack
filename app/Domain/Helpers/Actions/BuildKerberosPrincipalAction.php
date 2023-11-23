<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Helpers\Actions;

use function func_get_args;

class BuildKerberosPrincipalAction
{

    /**
     * This action builds a Kerberos principal name for a given group, hostname and node ID
     **/


    public function execute($group, $hostname, $nodeId)
    {
        return action_success((new BuildKerberosCRDNameAction())->execute($group, $hostname, $nodeId)['data'] . '@' . config('manager.realm'));
    }

}
