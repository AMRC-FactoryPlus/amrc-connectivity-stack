<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Nodes\Actions;

use App\Domain\Groups\Models\Group;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Actions\GrantUserPermissionToAccessNodeAction;
use App\Domain\Nodes\Models\Node;
use Tests\TestCase;

class GrantUserPermissionToAccessNodeActionTest extends TestCase
{
    /** @test */
    public function it_grants_the_user_permission()
    {
        $this->signIn();

        auth()->user()->update(
            [
                'administrator' => 1,
            ]
        );

        Group::create([
            'id' => 1,
            'name' => 'Test Group',
            'cluster_id' => 1,
        ]);

        (new CreateNodeAction)->execute(Group::first(), 'My_Node');

        (new GrantUserPermissionToAccessNodeAction)->execute(auth()->user(), Node::first());

        self::assertCount(1, auth()->user()->accessibleNodes);
    }
}
