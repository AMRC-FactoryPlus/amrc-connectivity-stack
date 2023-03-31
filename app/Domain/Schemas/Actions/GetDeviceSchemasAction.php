<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Schemas\Actions;

use App\DeviceSchema;

class GetDeviceSchemasAction
{
    /**
     * This action gets all schema types registered in the application
     **/
    public function execute($searchTerm = null)
    {
        if ($searchTerm) {
            return action_success(DeviceSchema::search($searchTerm)->get());
        }

        return action_success(DeviceSchema::all());
    }
}
