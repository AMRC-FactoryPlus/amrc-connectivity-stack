<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Devices\Actions;

use App\Domain\Devices\Models\Device;
use App\Domain\Nodes\Models\Node;
use App\Exceptions\ActionFailException;

class CreateDeviceAction
{
    /**
     * This action creates an empty device to be populated for the supplied Node
     **/
    public function execute(Node $node)
    {
        if (! auth()->user()->administrator && ! auth()->user()->accessibleNodes->contains($node)) {
            throw new ActionFailException('You do not have permission to create devices for this node.', 401);
        }

        return action_success(
            Device::create([
                'node_id' => $node->id,
            ])
        );
    }
}
