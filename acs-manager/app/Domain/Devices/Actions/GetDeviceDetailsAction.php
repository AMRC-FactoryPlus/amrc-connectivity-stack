<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Actions;

use App\Domain\Devices\Models\Device;
use App\Exceptions\ActionFailException;

class GetDeviceDetailsAction
{
    /**
     * This action gets the details of the supplied device
     **/
    public function execute(Device $device)
    {
        if (! auth()->user()->administrator && ! auth()->user()->accessibleNodes->contains($device->node)) {
            throw new ActionFailException('You do not have permission to view devices for this node.', 401);
        }

        return action_success($device);
    }
}
