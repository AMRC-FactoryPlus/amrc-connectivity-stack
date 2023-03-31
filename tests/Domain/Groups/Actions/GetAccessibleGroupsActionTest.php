<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Groups\Actions;

use App\Domain\Groups\Actions\GetAccessibleGroupsAction;
use App\Domain\Groups\Models\Group;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Actions\GrantUserPermissionToAccessNodeAction;
use App\Domain\Nodes\Models\Node;
use Tests\TestCase;

class GetAccessibleGroupsActionTest extends TestCase
{
    /** @test */
    public function a_user_can_get_their_accessible_groups()
    {
        $this->signIn();

        auth()->user()->update(
            [
                'administrator' => 1,
            ]
        );

        $group = Group::create(
            [
                'id' => 1,
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        (new CreateNodeAction)->execute($group, 'My_Node');

        (new GrantUserPermissionToAccessNodeAction)->execute(auth()->user(), Node::first());

        self::assertEquals($group->id, (new GetAccessibleGroupsAction)->execute()['data']->get()->first()->id);
    }
}
