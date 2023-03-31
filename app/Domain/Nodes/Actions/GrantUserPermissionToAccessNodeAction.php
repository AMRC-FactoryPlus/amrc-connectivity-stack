<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Nodes\Actions;

use App\Domain\Nodes\Models\Node;
use App\Domain\Users\Models\User;

class GrantUserPermissionToAccessNodeAction
{
    /**
     * This action grants the given user access to the supplied node
     **/
    public function execute(User $user, Node $node)
    {
        $user->accessibleNodes()->attach($node);

        return action_success();
    }
}
