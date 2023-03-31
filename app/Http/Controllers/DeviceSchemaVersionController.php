<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\DeviceSchema;
use App\Domain\Schemas\Actions\GetDeviceSchemaVersionsAction;
use App\Exceptions\ActionFailException;

class DeviceSchemaVersionController extends Controller
{
    public function index()
    {
        // Get the deviceSchema
        $deviceSchema = DeviceSchema::where('id', request()->route('schema'))->with('versions')->first();
        if (! $deviceSchema) {
            throw new ActionFailException(
                'The device schema does not exist.', 404
            );
        }

        return process_action((new GetDeviceSchemaVersionsAction)->execute($deviceSchema, request()->query('search')));
    }
}
