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

class DownloadFileForDeviceAction
{
    public function execute(Device $device, $fileUuid)
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $response = (new MakeConsumptionFrameworkRequest)->execute(type: 'post', service: 'file-service',
            url: config('manager.file_service_url') . '/download', payload: [
                'instance_uuid' => $device->instance_uuid, 'file_uuid' => $fileUuid,
            ])['data'];

        return action_success($response->body());
    }

    /**
     * This action gets a temporarily signed URL from the file service and returns it to the frontend
     **/
    private function authorise(Device $device, $fileUuid)
    {
        if (! auth()->user()->administrator && ! auth()->user()->accessibleNodes->contains($device->loadMissing('node')->node)) {
            throw new ActionFailException('You do not have permission to download files for this device.', 401);
        }
    }

    private function validate()
    {
    }
}
