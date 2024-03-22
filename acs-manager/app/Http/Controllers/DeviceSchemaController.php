<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Schemas\Actions\GetDeviceSchemasAction;
use App\Domain\Schemas\Actions\ImportSchemasFromStorageAction;

class DeviceSchemaController extends Controller
{
    public function index()
    {
        return process_action((new GetDeviceSchemasAction)->execute(request()->query('search')));
    }

    public function create()
    {
        return process_action((new ImportSchemasFromStorageAction)->execute());
    }
}
