<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Actions;

use App\DeviceConnection;
use App\Domain\Devices\Models\Device;
use App\Domain\Nodes\Models\Node;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Str;

class CreateDeviceConnectionAction
{
    /**
     * This action is responsible for creating a blank DeviceConnection for a Device
     **/
    /*
     * Constraints:
     * - The current user must have permission to modify devices for this node
     */

    public function execute(
        Node $node,
    ) {
        // =========================
        // Validate User Permissions
        // =========================
        if ((! auth()->user()->administrator) && ! in_array(
            $node->id,
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

        // Create the device connection for this device
        return action_success(
            DeviceConnection::create([
                'name' => Str::uuid(),
                'node_id' => $node->id,
                'file' => null,
                'active' => false,
            ])
        );
    }
}
