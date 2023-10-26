<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Groups\Actions\DeleteGroupAction;
use App\Domain\Groups\Actions\GetAccessibleGroupsAction;
use App\Domain\Groups\Models\Group;
use App\Exceptions\ActionFailException;
use App\Http\Requests\CreateGroupRequest;

class GroupController extends Controller
{
    public function index()
    {
        return process_action((new GetAccessibleGroupsAction)->execute());
    }

    public function store(CreateGroupRequest $request)
    {
        $validated = $request->validated();

        // Get the cluster
        $cluster = Cluster::where('id', $validated['cluster_id'])
                          ->first();
        if (! $cluster) {
            throw new ActionFailException('The cluster does not exist.', 404);
        }

        return process_action((new CreateGroupAction)->execute($validated['name'], $cluster));
    }

    public function destroy()
    {

        // Get the group
        $group = Group::whereId(request()->route('group'))->firstOr(function() {
            throw new ActionFailException('The group does not exist.', 404);
        });

        (new DeleteGroupAction())->execute($group);

    }
}
