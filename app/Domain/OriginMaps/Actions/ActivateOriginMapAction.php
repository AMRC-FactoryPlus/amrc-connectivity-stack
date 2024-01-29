<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\OriginMaps\Actions;

use App\Domain\Nodes\Actions\UpdateEdgeAgentConfigurationForNodeAction;
use App\Domain\OriginMaps\Models\OriginMap;
use App\Exceptions\ActionForbiddenException;

class ActivateOriginMapAction
{
    /**
     * This action sets the `active` flag of this origin map for the device and clears all others.
     * for all devices for this node and attaches it to the Node. Finally, it sends an NCMD to the node to reload its config.
     **/
    public function execute(OriginMap $originMap)
    {
        // =========================
        // Validate User Permissions
        // =========================
        if ((! auth()->user()->administrator) && ! (in_array($originMap->device->node_id, auth()->user()->accessibleNodes()->get()->pluck('id')->all(),
            true))) {
            throw new ActionForbiddenException('You do not have permission to configure a device in this node.');
        }

        // ===================
        // Perform the Action
        // ===================

        // Set this origin map as the only active one for this device
        $originMap->device->originMaps()->update([
            'active' => 0,
        ]);
        $originMap->update([
            'active' => 1,
        ]);

        (new UpdateEdgeAgentConfigurationForNodeAction)->execute($originMap->device->node->fresh());

        return action_success();
    }
}
