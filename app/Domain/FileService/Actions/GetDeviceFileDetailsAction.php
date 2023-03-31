<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\FileService\Actions;

use App\Domain\Support\Actions\MakeConsumptionFrameworkRequest;

use function func_get_args;

class GetDeviceFileDetailsAction
{
    public function execute(string $fileUuid)
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $response = (new MakeConsumptionFrameworkRequest)->execute(type: 'get', service: 'file-service',
            url: config('manager.file_service_url') . '/file/' . $fileUuid)['data'];

        return action_success($response->json());
    }

    /**
     * This action gets details for a given file UUID
     **/
    private function authorise()
    {
    }

    private function validate()
    {
    }
}
