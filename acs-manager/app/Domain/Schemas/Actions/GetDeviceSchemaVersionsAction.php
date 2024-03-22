<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Schemas\Actions;

use App\DeviceSchema;
use App\DeviceSchemaVersion;

class GetDeviceSchemaVersionsAction
{
    /**
     * This action gets all versions for the supplied device schema
     **/
    public function execute(DeviceSchema $deviceSchema, $searchTerm)
    {
        if ($searchTerm) {
            return action_success(DeviceSchemaVersion::search($searchTerm)->where('device_schema_id', $deviceSchema->id)->get());
        }

        return action_success($deviceSchema->versions);
    }
}
