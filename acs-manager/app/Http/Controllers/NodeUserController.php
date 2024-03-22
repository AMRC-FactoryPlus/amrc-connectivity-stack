<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Nodes\Actions\GrantUserPermissionToAccessNodeAction;
use App\Domain\Nodes\Models\Node;
use App\Domain\Users\Models\User;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use App\Http\Requests\GrantUserPermissionToAccessNodeRequest;

class NodeUserController extends Controller
{
    public function store(GrantUserPermissionToAccessNodeRequest $request)
    {
        $validated = $request->validated();

        if (!auth()->user()->administrator) {
            throw new ActionForbiddenException('Only administrators can grant access to nodes.');
        }

        // Get the user
        $user = User::where('username', $validated['user'])->firstOr(function() {
            throw new ActionFailException('The user does not exist.', 404);
        });

        // Get the node
        $node = Node::where('id', request()->route('node'))->firstOr(function() {
            throw new ActionFailException('The node does not exist.', 404);
        });

        (new GrantUserPermissionToAccessNodeAction())->execute($user, $node);
    }
}
