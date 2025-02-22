<?php
/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

namespace App\Domain\Devices\Actions;

use App\Domain\Devices\Models\Device;
use App\Domain\Nodes\Actions\UpdateEdgeAgentConfigurationForNodeAction;
use App\Exceptions\ActionFailException;

class UpdateDeviceInformationAction
{
    /**
     * This action updates the information of a device
     **/
    /*
     * Constraints:
     * - The user must have access to the node that the device is attached to
     */

    public function execute(Device $device, $deviceId, $pubInterval = 0)
    {
        if (! auth()->user()->administrator && ! auth()->user()->accessibleNodes->contains($device->node)) {
            throw new ActionFailException('You do not have permission to update this device.', 401);
        }

        // ===================
        // Perform the Action
        // ===================
        $device->update([
            'device_id' => $deviceId,
            'pub_interval' => $pubInterval,
        ]);

        // Create a for all active devices in this node and attach it to the Node
        (new UpdateEdgeAgentConfigurationForNodeAction)->execute($device->node->fresh());

        return action_success();
    }
}
