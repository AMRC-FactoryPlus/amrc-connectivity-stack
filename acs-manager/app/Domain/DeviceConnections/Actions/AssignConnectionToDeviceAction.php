<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\DeviceConnections\Actions;

use App\DeviceConnection;
use App\Domain\Devices\Models\Device;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;

use function func_get_args;

class AssignConnectionToDeviceAction
{
    public function execute(DeviceConnection $deviceConnection, Device $device)
    {
        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $device->update([
            'device_connection_id' => $deviceConnection->id,
        ]);

        return action_success();
    }

    /**
     * This action sets the connection for a specific device
     **/
    private function authorise(DeviceConnection $deviceConnection, Device $device)
    {
        if ((! auth()->user()->administrator) && ! in_array(
            $deviceConnection->node->id,
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
    }

    private function validate(DeviceConnection $deviceConnection, Device $device)
    {
        if ($deviceConnection->node_id !== $device->node_id) {
            throw new ActionFailException('The connection does not belong to this node.');
        }
    }
}
