<?php

/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Actions;

use App\DeviceSchema;
use App\DeviceSchemaVersion;
use App\Exceptions\ActionFailException;

class AddDeviceSchemaAction
{
    /**
     * This action takes a schema file and creates an entry in the database for the schema, extracting the ID in the form of
     * `Smart_Tool/Smart_Tool`. It creates a DeviceSchema model in the database that can be used for creating new devices.
     **/
    /*
     * Constraints:
     * - The user must be an administrator
     */

    public function execute(string $schemaUrl)
    {
        // ===================
        // Perform the Action
        // ===================

        // Fetch the JSON file
        $schemaRaw = json_decode(file_get_contents($schemaUrl), true, 512, JSON_THROW_ON_ERROR);
        preg_match_all(
            '/(^https:\/\/raw.githubusercontent.com\/AMRC-FactoryPlus\/schemas\/main\/([\w\/_]+))-v(\d+).json/',
            $schemaRaw['$id'],
            $schemaId
        );

        $name = $schemaId[2][0];
        $version = $schemaId[3][0];
        $schemaUUID = $schemaRaw['properties']['Schema_UUID']['const'] ?? null;

        $schema = DeviceSchema::updateOrCreate([
            'name' => $name,
            'url' => $schemaId[1][0],
        ]);

        DeviceSchemaVersion::updateOrCreate([
            'device_schema_id' => $schema->id,
            'version' => $version,
        ], [
            'schema_uuid' => $schemaUUID,
        ]);

        return action_success($schema);
    }
}
