<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Nodes\Actions;

use App\Domain\Groups\Models\Group;
use App\Domain\Nodes\Models\Node;

class GetAccessibleNodesAction
{
    /**
     * This action gets all nodes that the user is authorised to view for the given cluster
     **/
    public function execute($clusterUUID)
    {
        $searchTerm = request()->query('search');

        // If we have a search term then get all of the model IDs that match the search
        $modelIDs = [];
        if ($searchTerm) {
            $modelIDs = Node::search($searchTerm)->get()->pluck('id');
        }

        // If the user is not an administrator then they can only see their accessible nodes
        if (! auth()->user()->administrator) {
            $query = auth()->user()->accessibleNodes();
        } else {
            $query = Node::query();
        }

        return action_success(
            $query
                // Only return nodes for the selected cluster
                ->whereCluster($clusterUUID)
                // Don't return nodes without a node_id (MQTT bridges)
                ->whereNotNull('nodes.node_id')
                // If we have a search term then apply then filter only the models that were returned from the search
                ->when($searchTerm !== null, function ($query) use ($modelIDs) {
                    $query->whereIn('id', $modelIDs);
                }));
    }
}
