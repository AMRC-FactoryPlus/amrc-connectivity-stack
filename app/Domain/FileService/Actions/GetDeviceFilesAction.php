<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\FileService\Actions;

use App\Domain\Devices\Models\Device;
use App\Domain\Support\Actions\MakeConsumptionFrameworkRequest;
use App\Exceptions\ActionFailException;

use function func_get_args;

class GetDeviceFilesAction
{
    public function execute(Device $device)
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $response = (new MakeConsumptionFrameworkRequest)->execute(
            type: 'get',
            service: 'file-service',
            url: config(
                'manager.file_service_url'
            ) . '/device/' . $device->instance_uuid
        )['data'];

        return action_success($response->json());
    }

    /**
     * This action gets all uploaded files for a given device
     **/
    private function authorise(Device $device)
    {
        if (! auth()->user()->administrator && ! auth()->user()->accessibleNodes->contains($device->loadMissing('node')->node)) {
            throw new ActionFailException('You do not have permission to get files for this device.', 401);
        }
    }

    private function validate()
    {
    }
}
