<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\EdgeClusters\Actions;

use AMRCFactoryPlus\ServiceClient;
use AMRCFactoryPlus\UUIDs\App;
use AMRCFactoryPlus\UUIDs\Service;

use function func_get_args;

class GetHelmChartsAction
{

    /**
     * This action
     **/

    private function authorise() {}

    private function validate() {}

    public function execute()
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());

        $fplus = resolve(ServiceClient::class);
        $configDB = $fplus->getConfigDB();

        $helmChartTemplates = [];

        // Iterate through the edge clusters
        foreach ($configDB->getConfig(App::HelmChartTemplate) as $helmChartTemplate) {

            // Then hit the general object information endpoint for each chart to get its name
            $name = $configDB->getConfig(App::Info, $helmChartTemplate)['name'];

            $helmChartTemplates[$helmChartTemplate] = [
                'name' => $name,
            ];
        }


        return action_success($helmChartTemplates);
    }

}
