<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\FileService\Actions;

use App\Domain\Devices\Models\Device;
use App\Domain\Support\Actions\MakeConsumptionFrameworkRequest;

use function func_get_args;

class GetAvailableFilesForDeviceAction
{
    public function execute(Device $device)
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $response = (new MakeConsumptionFrameworkRequest)->execute(type: 'get', service: 'file-service',
            url: config('manager.file_service_url') . '/config/' . $device->latestOriginMap->schema_uuid)['data'];

        return action_success($response->json());
    }

    /**
     * This action gets all available files to upload as per the file service
     **/
    private function authorise()
    {
    }

    private function validate()
    {
    }
}
