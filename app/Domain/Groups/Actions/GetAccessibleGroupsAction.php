<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Groups\Actions;

use App\Domain\Groups\Models\Group;
use Illuminate\Database\Eloquent\Builder;

class GetAccessibleGroupsAction
{
    /**
     * This action gets all the groups that contain nodes that the current user has permission to access
     **/
    public function execute()
    {
        // ===================
        // Perform the Action
        // ===================

        $searchTerm = request()->query('search');

        // If we have a search term then get all of the model IDs that match the search
        $modelIDs = [];
        if ($searchTerm) {
            $modelIDs = Group::search($searchTerm)->get()->pluck('id');
        }

        return action_success(Group::
        // If we have a search term then apply then filter only the models that were returned from the search
        when($searchTerm !== null, function ($query) use ($modelIDs) {
            $query->whereIn('id', $modelIDs);
        })
            // If we are not an administrator then filter only the groups for nodes that we have access to
            ->when(! auth()->user()->administrator, function ($query) {
                $query->whereIn('id', auth()->user()->accessibleNodes->pluck('group.id'));
            })
            // Return the count of the nodes with the result (excluding any bridges)
            ->withCount([
                'nodes' => function (Builder $query) {
                    $query->whereNotNull('node_id');
                },
            ]));
    }
}
