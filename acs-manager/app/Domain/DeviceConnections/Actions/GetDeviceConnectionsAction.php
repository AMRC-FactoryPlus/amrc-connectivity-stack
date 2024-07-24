<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\DeviceConnections\Actions;

use App\Domain\Nodes\Models\Node;
use App\Exceptions\ActionFailException;

use function action_success;

class GetDeviceConnectionsAction
{
    /**
     * This action gets all of the connections for a given node
     **/
    public function execute(Node $node)
    {
        // =========================
        // Validate User Permissions
        // =========================
        if (! auth()->user()->administrator && ! auth()->user()->accessibleNodes->contains($node)) {
            throw new ActionFailException('You do not have permission to get connections for this node.', 401);
        }

        return action_success($node->deviceConnections()->orderByDesc('updated_at')->get());
    }
}
