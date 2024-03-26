<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Actions;

use App\DeviceConnection;
use App\Domain\DeviceConnections\Actions\AssignConnectionToDeviceAction;
use App\Domain\Devices\Models\Device;
use App\Domain\Nodes\Actions\UpdateEdgeAgentConfigurationForNodeAction;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Errors\ValidationError;
use Opis\JsonSchema\Validator;

class ConfigureDeviceConnectionAction
{
    /**
     * This action is responsible for taking a Device, JSON config and Device Schema and validating the config before saving it to disk
     *
     * @throws \JsonException
     */
    /*
     * Constraints:
     * - The current user must have permission to modify devices for this node
     */

    public function execute(
        DeviceConnection $deviceConnection,
        string $connectionConfiguration,
        Device $device = null,
    ) {
        // =========================
        // Validate User Permissions
        // =========================
        if ((!auth()->user()->administrator) && !in_array(
                $deviceConnection->node->id,
                auth()->user()->accessibleNodes()->get()->pluck('id')->all(),
                true
            )) {
            throw new ActionForbiddenException('You do not have permission to configure a device in this node.');
        }

        // If a device is passed to link this config to then it must be in the same node
        if ($device && $deviceConnection->node_id !== $device->node_id) {
            throw new ActionFailException(
                'The connection could not be applied to this device because they do not belong to the same node.'
            );
        }

        // =======================================
        // Validate the Connection Config
        // =======================================
        $connectionConfig = json_decode($connectionConfiguration, false, 512, JSON_THROW_ON_ERROR);
        // Register the connection schema
        $connectionValidator = new Validator;
        $connectionValidator->resolver()->registerRaw(
                file_get_contents(
                    'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Device_Connection.json'
                ),
                'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Device_Connection.json'
            );
        // Validate that the JSON supplied is valid against the connection schema
        $validated = $connectionValidator->validate(
            $connectionConfig,
            'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Device_Connection.json'
        );
        if (!$validated->isValid()) {
            // Get the error
            $error = $validated->error();

            // Create an error formatter
            $formatter = new ErrorFormatter;

            $custom = function (ValidationError $error) use ($formatter) {
                return [
                    'keyword' => $error->keyword(),
                    'message' => $formatter->formatErrorMessage($error),

                    'dataPath' => $formatter->formatErrorKey($error),
                    'dataValue' => $error->data()->value(),
                ];
            };

            $errors = $formatter->formatFlat($error, $custom);
            Log::error('Connection details JSON file is not valid!', [
                'error' => $errors[count($errors) - 1],
            ]);

            throw new ActionFailException('Connection details JSON file is not valid!');
        }


        // Upload the Device Connection
        $connectionDetailsFilename = uniqid('', true) . '.json';
        Storage::disk('device-connections')->put(
            $connectionDetailsFilename,
            json_encode($connectionConfig, JSON_THROW_ON_ERROR)
        );

        // Update the device connection for this device
        $deviceConnection->update([
            'name' => $connectionConfig->name,
            'file' => $connectionDetailsFilename,
        ]);

        if ($device) {
            // Assign the connection to this device
            (new AssignConnectionToDeviceAction)->execute(deviceConnection: $deviceConnection, device: $device);
        }

        (new UpdateEdgeAgentConfigurationForNodeAction)->execute($deviceConnection->node->fresh());

        return action_success();
    }
}
