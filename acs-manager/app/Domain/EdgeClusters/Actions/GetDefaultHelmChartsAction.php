<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\EdgeClusters\Actions;

use AMRCFactoryPlus\ServiceClient;
use AMRCFactoryPlus\UUIDs\App;
use AMRCFactoryPlus\UUIDs\Service;
use App\Exceptions\ActionForbiddenException;

use function func_get_args;

class GetDefaultHelmChartsAction
{

    /**
     * This action gets the default Helm chart UUIDs for each type of chart from the ConfigDB
     **/

    private function authorise()
    {
        if ((!auth()->user()->administrator)) {
            throw new ActionForbiddenException('You do not have permission to get default Helm chart values.');
        }
    }

    public function execute()
    {

        // Validate and authorise the request
        $this->authorise(...func_get_args());

        $fplus = resolve(ServiceClient::class);
        $configDB = $fplus->getConfigDB();

        return action_success($configDB->getConfig(App::ServiceSetup, Service::Manager));
    }

}
