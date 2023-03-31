<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\FileService\Actions;

use App\Domain\Devices\Models\Device;
use App\Domain\Support\Actions\MakeConsumptionFrameworkRequest;
use App\Exceptions\ActionFailException;
use Illuminate\Http\UploadedFile;

use function func_get_args;

class UploadFileForDeviceAction
{
    public function execute(
        Device $device,
        string $fileTypeKey,
        string $friendlyTitle,
        string $friendlyDescription,
        string $uploader,
        UploadedFile $file,
        $tags
    ) {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        (new MakeConsumptionFrameworkRequest)->execute(
            type: 'post',
            service: 'file-service',
            url: config('manager.file_service_url') . '/upload', payload: [
                'instance_uuid' => $device->instance_uuid,
                'file_type_key' => $fileTypeKey,
                'friendly_title' => $friendlyTitle,
                'friendly_description' => $friendlyDescription,
                'uploader' => $uploader,
                'tags' => json_encode($tags, JSON_THROW_ON_ERROR),
            ],
            file: $file
        )['data'];

        return action_success();
    }

    /**
     * This action makes a request to the File Service to upload a file against a specific device
     **/
    private function authorise(
        Device $device,
        string $fileTypeKey,
        string $friendlyTitle,
        string $friendlyDescription,
        string $uploader,
        UploadedFile $file,
        $tags
    ) {
        if (! auth()->user()->administrator && ! auth()->user()->accessibleNodes->contains($device->loadMissing('node')->node)) {
            throw new ActionFailException('You do not have permission to upload files for this device.', 401);
        }
    }

    private function validate()
    {
    }
}
