<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Actions;

use App\DeviceSchema;
use App\DeviceSchemaVersion;
use App\Domain\Devices\Models\Device;
use App\Domain\OriginMaps\Actions\ActivateOriginMapAction;
use App\Domain\OriginMaps\Models\OriginMap;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Errors\ValidationError;
use Opis\JsonSchema\Validator;

class ConfigureDeviceAction
{
    /**
     * This action is responsible for taking a Device, JSON config and Device Schema and validating the config before saving it to disk
     **/
    /*
     * Constraints:
     * - The current user must have permission to modify devices for this node
     */

    public function execute(
        Device $device,
        string $schemaUUID,
        #DeviceSchema $deviceSchema,
        #DeviceSchemaVersion $version,
        string $deviceConfiguration,
        bool $active
    ) {
        // =========================
        // Validate User Permissions
        // =========================
        if ((! auth()->user()->administrator) && ! in_array(
            $device->node->id,
            auth()
                ->user()
                ->accessibleNodes()
                ->get()
                ->pluck('id')
            ->all(),
            true
        )) {
            throw new ActionForbiddenException('You do not have permission to configure a device in this node.');
        }

        // ===================
        // Validate the Device Config
        // ===================

        // Decode $deviceConfig
        $deviceConfig = json_decode($deviceConfiguration, false, 512, JSON_THROW_ON_ERROR);

        // Validate that the JSON supplied is valid against the supplied schema
        $deviceValidator = resolve(Validator::class);
        $validated = $deviceValidator->validate($deviceConfig, 
                "urn:uuid:" . $schemaUUID);
        if (! $validated->isValid()) {
            // Get the error
            $error = $validated->error();

            // Create an error formatter
            $formatter = new ErrorFormatter;

            $custom = function (ValidationError $error) use ($formatter) {
                return [
                    'keyword' => $error->keyword(),
                    'message' => $formatter->formatErrorMessage($error),

                    'dataPath' => $formatter->formatErrorKey($error),
                    'dataValue' => $error->data()
                                         ->value(),
                ];
            };

            $errors = $formatter->formatFlat($error, $custom);
            Log::error('JSON file is not valid against ' . $schemaUUID . '!', [
                'error' => $errors[count($errors) - 1],
            ]);

            throw new ActionFailException(
                'The configuration is not valid for ' . $schemaUUID . '. ' . $errors[count(
                    $errors
                ) - 1]['message'] . ' at ' . $errors[count($errors) - 1]['dataPath']
            );
        }

        // Upload the origin map
        $originMapFilename = uniqid('', true);
        Storage::disk('device-configurations')
                ->put($originMapFilename . '.json', json_encode($deviceConfig, JSON_THROW_ON_ERROR));

        // Create the origin map for this device
        $originMap = OriginMap::create([
            'name' => Str::uuid(),
            'device_id' => $device->id,
            'file' => $originMapFilename . '.json',
            'active' => $active,
            'schema_uuid' => $schemaUUID,
        ]);

        // Save the InstanceUUID and SchemaUUID against the device
        $device->update([
            'instance_uuid' => $deviceConfig->Instance_UUID,
        ]);

        if ($active) {
            (new ActivateOriginMapAction)->execute($originMap->load('device.node'));
        }

        return action_success();
    }
}
