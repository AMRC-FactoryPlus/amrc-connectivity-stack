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

        // Get the deviceSchema
        $deviceSchema = DeviceSchema::where('id', $validated['device_schema_id'])->first();
        if (! $deviceSchema) {
            throw new ActionFailException(
                'The device schema does not exist.', 404
            );
        }

        // Get the deviceSchemaVersion
        $deviceSchemaVersion = DeviceSchemaVersion::where('id', $validated['device_schema_version_id'])->first();
        if (! $deviceSchemaVersion) {
            throw new ActionFailException(
                'The device schema version does not exist.', 404
            );
        }

        // Configure the device with a draft pre-written device configuration
        (new ConfigureDeviceAction)->execute(
            device                    : $device->fresh()->load('node.group', 'originMaps'),
            deviceSchema              : $deviceSchema->fresh(),
            version                   : $deviceSchemaVersion,
            deviceConfiguration       : $validated['configuration'],
            deviceConfigurationMetrics: $validated['metrics'],
            active                    : $validated['activate']
        );
    }

    public function activate(Device $device)
    {
        (new ActivateOriginMapAction)->execute($device->originMaps()->with('device.node')->inactive()->latest()->first());
    }
}
