<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Devices\Actions\CreateDeviceAction;
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
use App\Http\Requests\UpdateDeviceInformationRequest;

class DeviceController extends Controller
{
    public function index()
    {
        // Get the node
        $node = Node::where('id', request()->route('node'))->first();
        if (!$node) {
            throw new ActionFailException(
                'The node does not exist.', 404
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
                'The node does not exist.', 404
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
                'The node does not exist.', 404
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
        if (! $device) {
            throw new ActionFailException(
                'The device does not exist.', 404
            );
        }

        if (request()->wantsJson()) {
            return process_action((new GetDeviceDetailsAction)->execute($device), DeviceDetailResource::class);
        }

        $initialData = [
            'device' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/clusters/' . $node->cluster . '/nodes/' . $node->id . '/devices/' . $device->id,
            ],
            'deviceSchemas' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/device-schemas',
            ],
            'deviceSchemaVersions' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/device-schemas/{schema}/versions',
            ],
            'deviceConnections' => [
                'value' => null,
                'method' => 'get',
                'url' => '/api/clusters/' . $node->cluster . '/nodes/' . $node->id . '/connections/',
            ]
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
                'The device does not exist.', 404
            );
        }

        (new UpdateDeviceInformationAction)->execute($device, $validated['device_id']);
    }

    public function destroy(DeleteDeviceRequest $request)
    {
        $validated = $request->validated();

        // Get the device
        $device = Device::with('node')->where('id', $request->route('device'))->first();
        if (! $device) {
            throw new ActionFailException(
                'The device does not exist.', 404
            );
        }

        return process_action((new DeleteDeviceAction())->execute($device));
    }
}
