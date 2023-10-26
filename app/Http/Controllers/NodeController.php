<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Devices\Actions\DeleteDeviceAction;
use App\Domain\Devices\Models\Device;
use App\Domain\Groups\Models\Group;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Actions\DeleteNodeAction;
use App\Domain\Nodes\Actions\GetAccessibleNodesAction;
use App\Domain\Nodes\Models\Node;
use App\Domain\Nodes\Resources\NodeResourceCollection;
use App\Exceptions\ActionFailException;
use App\Http\Requests\CreateNodeRequest;

class NodeController extends Controller
{
    public function index()
    {
        // Get the group
        $group = Group::where('id', request()->route('group'))->first();
        if (! $group) {
            throw new ActionFailException('The group does not exist.',
                404);
        }

        return process_action((new GetAccessibleNodesAction)->execute($group), NodeResourceCollection::class);
    }

    public function store(CreateNodeRequest $request)
    {
        $validated = $request->validated();

        // Get the group
        $group = Group::where('id', $request->route('group'))->first();
        if (! $group) {
            throw new ActionFailException('The group does not exist.',
                404);
        }

        return process_action((new CreateNodeAction)->execute(group: $group, nodeId: $validated['node_id'],
            enabled: $validated['enabled'],
            nodeHostname: $validated['node_hostname'] ?? null));
    }

    public function destroy()
    {

        // Get the device
        $node = Node::where('id', request()->route('node'))->first();
        if (! $node) {
            throw new ActionFailException(
                'The node does not exist.', 404
            );
        }

        return process_action((new DeleteNodeAction())->execute($node));

    }
}
