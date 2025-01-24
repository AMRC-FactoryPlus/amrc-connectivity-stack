<?php
/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

namespace App\Http\Controllers;

use App\DeviceSchemaVersion;
use App\Domain\DeviceConnections\Actions\AssignConnectionToDeviceAction;
use App\Domain\Devices\Actions\ConfigureDeviceAction;
use App\Domain\Devices\Actions\ConfigureDeviceConnectionAction;
use App\Domain\Devices\Actions\CreateDeviceAction;
use App\Domain\Devices\Actions\CreateDeviceConnectionAction;
use App\Domain\Devices\Actions\DeleteDeviceAction;
use App\Domain\Devices\Actions\GetAccessibleDevicesAction;
use App\Domain\Devices\Actions\GetDeviceDetailsAction;
use App\Domain\Devices\Actions\UpdateDeviceInformationAction;
use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Requests\CreateDeviceRequest;
use App\Domain\Devices\Resources\DeviceDetailResource;
use App\Domain\Nodes\Models\Node;
use App\Exceptions\ActionFailException;
use App\Http\Requests\DeleteDeviceRequest;
use App\Http\Requests\ImportDeviceRequest;
use App\Http\Requests\UpdateDeviceInformationRequest;

class DeviceController extends Controller
{
    public function index()
    {
        // Get the node
        $node = Node::where('id', request()->route('node'))->first();
        if (!$node) {
            throw new ActionFailException(
                'The node does not exist.', 404,
            );
        }

        return process_action((new GetAccessibleDevicesAction)->execute($node));
    }

    public function store(CreateDeviceRequest $request)
    {
        $validated = $request->validated();

        // Get the node
        $node = Node::where('id', $validated['node_id'])->first();
        if (!$node) {
            throw new ActionFailException(
                'The node does not exist.', 404,
            );
        }

        return process_action((new CreateDeviceAction)->execute($node));
    }

    public function show()
    {
        // Get the node (if admin they have access to all nodes)
        $query = auth()->user()->administrator ? Node::with('devices') : auth()->user()->accessibleNodes()->with('devices');
        $node = $query->where('nodes.id', request()->route('node'))->first();
        if (!$node) {
            throw new ActionFailException(
                'The node does not exist.', 404,
            );
        }

        // Get the device
        $device = $node->devices()->where('id', request()->route('device'))->with(
            'node',
            'latestOriginMap.schemaVersion.schema',
            'activeOriginMap.schemaVersion.schema',
            'originMaps',
            'deviceConnection',
        )->first();
        if (!$device) {
            throw new ActionFailException(
                'The device does not exist.', 404,
            );
        }

        if (request()->wantsJson()) {
            return process_action((new GetDeviceDetailsAction)->execute($device), DeviceDetailResource::class);
        }

        $initialData = [
            'device'               => [
                'value'  => null,
                'method' => 'get',
                'url'    => '/api/clusters/'.$node->cluster.'/nodes/'.$node->id.'/devices/'.$device->id,
            ],
            'deviceSchemas'        => [
                'value'  => null,
                'method' => 'get',
                'url'    => '/api/device-schemas',
            ],
            'deviceSchemaVersions' => [
                'value'  => null,
                'method' => 'get',
                'url'    => '/api/device-schemas/{schema}/versions',
            ],
            'deviceConnections'    => [
                'value'  => null,
                'method' => 'get',
                'url'    => '/api/clusters/'.$node->cluster.'/nodes/'.$node->id.'/connections/',
            ],
        ];

        // Return the view with the initial data
        return view('device-editor', [
            'initialData' => $initialData,
        ]);
    }

    public function update(UpdateDeviceInformationRequest $request)
    {
        $validated = $request->validated();

        // Get the device
        $device = Device::with('node')->where('id', $request->route('device'))->first();
        if (!$device) {
            throw new ActionFailException(
                'The device does not exist.', 404,
            );
        }

        (new UpdateDeviceInformationAction)->execute(
            $device,
            $validated['device_id'],
            $validated['pub_interval'],
        );
    }

    public function destroy(DeleteDeviceRequest $request)
    {
        $validated = $request->validated();

        // Get the device
        $device = Device::with('node')->where('id', $request->route('device'))->first();
        if (!$device) {
            throw new ActionFailException(
                'The device does not exist.', 404,
            );
        }

        return process_action((new DeleteDeviceAction())->execute($device));
    }

    public function import(ImportDeviceRequest $request)
    {
        $validated = $request->validated();

        $node = Node::where('id', $validated['node_id'])->first();

        // For each connection

        foreach ($request->connections as $connectionConfig) {
            // Create the first device
            $firstDevice = $connectionConfig['devices'][0];

            // Check if $node->devices has a device with the same deviceId
            $deviceName = $firstDevice['deviceId'];
            $existingDevice = $node->devices()->where('device_id', $firstDevice['deviceId'])->first();
            if ($existingDevice) {
                $deviceName = $existingDevice->device_id.'_'.now()->timestamp;
            }

            $device = (new CreateDeviceAction)->execute($node)['data'];
            (new UpdateDeviceInformationAction())->execute($device->fresh()->loadMissing(['node']), $deviceName);

            // See if the node already has a connection with the same name
            $connection = $node->deviceConnections()->where('name', $connectionConfig['name'])->first();
            if ($connection) {
                // Assign the connection to the device
                (new AssignConnectionToDeviceAction())->execute(deviceConnection: $connection->fresh()->loadMissing(['devices']),
                    device: $device->fresh
                    ());
            }
            else {
                $connection = (new CreateDeviceConnectionAction())->execute($node)['data'];
                (new ConfigureDeviceConnectionAction)->execute(
                    deviceConnection: $connection->fresh()->loadMissing(['node']),
                    connectionConfiguration: json_encode(array_diff_key($connectionConfig, ['devices' => []])),
                    device: $device,
                );
            }

            $connection->refresh();

            // Configure the schema
            // Get the SchemaUUID from the tags (array of objects) where Name is "Schema_UUID"
            $schemaUUID = collect($firstDevice['tags'])->where('Name', 'Schema_UUID')->first()['value'];
            $deviceSchemaVersion = DeviceSchemaVersion::where('schema_uuid', $schemaUUID)->first();
            $deviceSchema = $deviceSchemaVersion->loadMissing(['schema'])->schema;

            (new ConfigureDeviceAction)->execute(
                device: $device->fresh()->load('originMaps'),
                deviceSchema: $deviceSchema->fresh(),
                version: $deviceSchemaVersion,
                deviceConfiguration: json_encode($this->buildConfigFromFlatTags($firstDevice['tags'])),
                active: true,
            );

            foreach ($connectionConfig['devices'] as $index => $remainingDeviceConfig) {

                if ($index === 0) {
                    continue;
                }

                // Check if $node->devices has a device with the same deviceId
                $deviceName = $remainingDeviceConfig['deviceId'];
                $existingDevice = $node->devices()->where('device_id', $remainingDeviceConfig['deviceId'])->first();
                if ($existingDevice) {
                    $deviceName = $existingDevice->device_id.'_'.now()->timestamp;
                }

                $device = (new CreateDeviceAction)->execute($node)['data'];
                (new UpdateDeviceInformationAction())->execute($device->fresh()->loadMissing(['node']), $deviceName);


                // Assign the previously created connection to the
                // device
                (new AssignConnectionToDeviceAction())->execute(deviceConnection: $connection->fresh()->loadMissing(['devices']),
                    device: $device->fresh
                    ());

                // Configure the schema
                // Get the SchemaUUID from the tags (array of objects) where Name is "Schema_UUID"
                $schemaUUID = collect($remainingDeviceConfig['tags'])->where('Name', 'Schema_UUID')->first()['value'];
                $deviceSchemaVersion = DeviceSchemaVersion::where('schema_uuid', $schemaUUID)->first();
                $deviceSchema = $deviceSchemaVersion->loadMissing(['schema'])->schema;

                (new ConfigureDeviceAction)->execute(
                    device: $device->fresh()->load('originMaps'),
                    deviceSchema: $deviceSchema->fresh(),
                    version: $deviceSchemaVersion,
                    deviceConfiguration: json_encode($this->buildConfigFromFlatTags($remainingDeviceConfig['tags'])),
                    active: true,
                );
            }
        }
    }

    private function buildConfigFromFlatTags($tags): array
    {
        $config = [];

        foreach ($tags as $tag) {
            // Break the Name up by `/` to get the hierarchy
            $hierarchy = explode('/', $tag['Name']);

            // Create the hierarchy in the config
            $current = &$config;
            foreach ($hierarchy as $index => $key) {
                if ($index === count($hierarchy) - 1) {
                    // Add specific fields if they exist
                    if (str_ends_with($tag['Name'], 'Schema_UUID')) {
                        $current[$key] = $tag['value'];
                        continue;
                    }

                    if (str_ends_with($tag['Name'], 'Instance_UUID')) {
                        $current[$key] = $tag['value'];
                        continue;
                    }

                    // At the last key, populate with content
                    $current[$key] = [
                        "Sparkplug_Type"      => $tag['type'],
                        "Method"              => $tag['method'],
                        "Documentation"       => $tag['docs'],
                        "Record_To_Historian" => $tag['recordToDB'],
                    ];

                    if (isset($tag['value'])) {
                        $current[$key]['Value'] = $tag['value'];
                    }
                    if (isset($tag['address'])) {
                        $current[$key]['Address'] = $tag['address'];
                    }
                    if (isset($tag['path'])) {
                        $current[$key]['Path'] = $tag['path'];
                    }
                    if (isset($tag['engUnit'])) {
                        $current[$key]['Eng_Unit'] = $tag['engUnit'];
                    }
                    if (isset($tag['engLow'])) {
                        $current[$key]['Eng_Low'] = $tag['engLow'];
                    }
                    if (isset($tag['engHigh'])) {
                        $current[$key]['Eng_High'] = $tag['engHigh'];
                    }
                } else {
                    // For intermediate keys, ensure the array structure
                    if (!isset($current[$key])) {
                        $current[$key] = [];
                    }
                    $current = &$current[$key];
                }
            }
        }

        return $config;
    }
}
