<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Actions;

use App\Domain\Devices\Models\Device;
use App\Domain\Nodes\Models\Node;
use App\Exceptions\ActionFailException;
use Spatie\QueryBuilder\QueryBuilder;

class GetAccessibleDevicesAction
{
    /**
     * This action gets all devices for the given node
     **/
    public function execute(Node $node)
    {
        if (! auth()->user()->administrator && ! auth()->user()->accessibleNodes->contains($node)) {
            throw new ActionFailException('You do not have permission to view devices for this node.', 401);
        }

        if ($searchTerm = request()->query('search')) {
            $models = Device::search($searchTerm)->keys();
            $base = QueryBuilder::for(Device::class)->whereNodeId($node->id)->whereIn('devices.id', $models);
        } else {
            $base = QueryBuilder::for(Device::class)->whereNodeId($node->id);
        }

        return action_success($base->get(['id', 'device_id', 'instance_uuid']));
    }
}
