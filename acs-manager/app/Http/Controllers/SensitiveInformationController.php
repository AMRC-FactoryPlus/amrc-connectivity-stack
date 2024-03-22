<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use AMRCFactoryPlus\ServiceClient;
use AMRCFactoryPlus\UUIDs\App;
use App\Domain\Devices\Models\Device;
use App\Domain\SensitiveInformation\Actions\StoreSensitiveInformationAction;
use App\Exceptions\ActionFailException;
use App\Http\Requests\StoreSensitiveInformationRequest;

class SensitiveInformationController extends Controller
{
    public function create(StoreSensitiveInformationRequest $request)
    {
        $validated = $request->validated();

        // Get the device
        $device = Device::whereId($validated['device'])->with('node')->firstOr(function() {
            throw new ActionFailException('The device does not exist.', 404);
        });

        // Get the namespace from the Edge Cluster Config entry
        $fplus = resolve(ServiceClient::class);
        $configDB = $fplus->getConfigDB();
        $clusterConfiguration = $configDB->getConfig(App::EdgeClusterConfiguration, $device->node->cluster);

        return (new StoreSensitiveInformationAction())->execute(
            cluster: $device->node->cluster,
            node: $device->node->uuid,
            namespace: $clusterConfiguration['namespace'],
            value: $validated['value']
        );
    }
}
