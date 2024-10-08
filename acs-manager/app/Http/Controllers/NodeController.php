<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

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
        return process_action((new GetAccessibleNodesAction)->execute(request()->route('cluster')), NodeResourceCollection::class);
    }

    public function store(CreateNodeRequest $request)
    {
        $validated = $request->validated();

        return process_action(
            (new CreateNodeAction)->execute(
                infoName: $validated['info_name'],
                nodeName: $validated['node_name'],
                destinationCluster: $validated['destination_cluster'],
                charts: $validated['charts'],
                destinationNode: $validated['destination_node'],
            )
        );
    }

    public function destroy()
    {
        // Get the device
        $node = Node::where('id', request()->route('node'))->first();
        if (!$node) {
            throw new ActionFailException(
                'The node does not exist.', 404
            );
        }

        return process_action((new DeleteNodeAction())->execute($node));
    }
}
