<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\DeviceConnections\Actions;

use App\DeviceConnection;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Facades\Storage;

class GetDeviceConnectionDetailsAction
{
    /**
     * This action gets the details for the given connection
     **/
    public function execute(DeviceConnection $deviceConnection)
    {
        // =========================
        // Validate User Permissions
        // =========================
        if ((! auth()->user()->administrator) && ! (in_array($deviceConnection->node_id, auth()->user()->accessibleNodes()->get()->pluck('id')->all(), true))) {
            throw new ActionForbiddenException('You do not have permission to configure a device in this node.');
        }

        if ($deviceConnection->file === null) {
            throw new ActionFailException('Can not get details. This device connection has not been configured.');
        }

        return action_success(json_decode(Storage::disk('device-connections')->get($deviceConnection->file), false, 512, JSON_THROW_ON_ERROR));
    }
}
