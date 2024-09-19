<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\DeviceSchema;
use App\DeviceSchemaVersion;
use App\Domain\Devices\Actions\ConfigureDeviceAction;
use App\Domain\Devices\Models\Device;
use App\Domain\OriginMaps\Actions\ActivateOriginMapAction;
use App\Exceptions\ActionFailException;
use App\Http\Requests\UpdateDeviceOriginMapRequest;

class OriginMapController extends Controller
{
    public function update(UpdateDeviceOriginMapRequest $request, Device $device)
    {
        $validated = $request->validated();

        // Configure the device with a draft pre-written device configuration
        (new ConfigureDeviceAction)->execute(
            device                    : $device->fresh()->load('originMaps'),
            schemaUUID                : $validated['schema_uuid'],
            deviceConfiguration       : $validated['configuration'],
            active                    : $validated['activate']
        );
    }

    public function activate(Device $device)
    {
        (new ActivateOriginMapAction)->execute($device->originMaps()->with('device.node')->inactive()->latest()->first());
    }
}
