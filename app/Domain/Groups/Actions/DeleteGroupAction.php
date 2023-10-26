<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Groups\Actions;

use App\Domain\Devices\Models\Device;
use App\Domain\Groups\Models\Group;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Facades\Log;
use function func_get_args;

class DeleteGroupAction
{

    /**
     * This action
     **/

    private function authorise(Group $group) {
        if (! auth()->user()->administrator) {
            throw new ActionForbiddenException('You do not have permission to delete groups.', 401);
        }
    }

    private function validate(Group $group) {
        // Check that the node has no devices
        if ($group->nodes->count() > 0) {
            throw new ActionFailException('You cannot delete a group that has nodes. Delete all nodes from the group first and try again.');
        }
    }

    public function execute(Group $group)
    {

        // Validate and authorise the request
        $this->authorise(...func_get_args());
        $this->validate(...func_get_args());

        $group->delete();

        Log::info('Group deleted', ['group' => $group]);

        return action_success();
    }

}
