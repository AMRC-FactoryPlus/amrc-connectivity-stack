<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\DeviceConnection;
use App\Domain\DeviceConnections\Actions\AssignConnectionToDeviceAction;
use App\Domain\DeviceConnections\Actions\GetDeviceConnectionDetailsAction;
use App\Domain\DeviceConnections\Actions\GetDeviceConnectionsAction;
use App\Domain\DeviceConnections\Actions\RegisterConnections;
use App\Domain\Devices\Actions\ConfigureDeviceConnectionAction;
use App\Domain\Devices\Actions\CreateDeviceConnectionAction;
use App\Domain\Devices\Models\Device;
use App\Domain\Nodes\Models\Node;
use App\Exceptions\ActionFailException;
use App\Http\Requests\UpdateDeviceConnectionRequest;
use App\Http\Requests\UseDeviceConnectionRequest;

use function request;

class DeviceConnectionController extends Controller
{
    public function index()
    {
        // Get the node
        $node = Node::where('id', request()->route('node'))
                    ->first();
        if (! $node) {
            throw new ActionFailException(
                'The node does not exist.', 404
            );
        }

        return process_action((new GetDeviceConnectionsAction)->execute($node));
    }

    public function create()
    {
        // Get the node
        $node = Node::where('id', request()->route('node'))
                    ->first();
        if (! $node) {
            throw new ActionFailException(
                'The node does not exist.', 404
            );
        }

        return process_action((new CreateDeviceConnectionAction)->execute($node->fresh()));
    }

    public function show()
    {
        // Get the deviceConnection
        $deviceConnection = DeviceConnection::with('node')->where('id', request()->route('connection'))
                                            ->first();
        if (! $deviceConnection) {
            throw new ActionFailException(
                'The device connection does not exist.', 404
            );
        }

        return process_action((new GetDeviceConnectionDetailsAction)->execute($deviceConnection));
    }

    public function update(UpdateDeviceConnectionRequest $request)
    {
        $validated = $request->validated();

        // Get the deviceConnection
        $deviceConnection = DeviceConnection::where('id', request()->route('connection'))
                                            ->with('node')
                                            ->first();
        if (! $deviceConnection) {
            throw new ActionFailException(
                'The device connection does not exist.', 404
            );
        }

        $device = Device::where('id', $validated['device'])
                        ->first();

        return process_action(
            (new ConfigureDeviceConnectionAction)->execute(
                deviceConnection: $deviceConnection,
                connectionConfiguration: $validated['configuration'],
                device: $device
            )
        );
    }

    public function use(UseDeviceConnectionRequest $request)
    {
        $validated = $request->validated();

        // Get the deviceConnection
        $deviceConnection = DeviceConnection::where('id', request()->route('connection'))
                                            ->with('node')
                                            ->first();
        if (! $deviceConnection) {
            throw new ActionFailException(
                'The device connection does not exist.', 404
            );
        }

        $device = Device::where('id', $validated['device'])
                        ->first();

        return process_action((new AssignConnectionToDeviceAction)->execute(deviceConnection: $deviceConnection, device: $device));
    }
}
