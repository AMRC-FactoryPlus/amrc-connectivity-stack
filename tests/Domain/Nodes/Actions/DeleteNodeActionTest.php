<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Nodes\Actions;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Actions\DeleteNodeAction;
use App\Domain\Nodes\Models\Node;
use Tests\TestCase;

class DeleteNodeActionTest extends TestCase
{

    public function test()
    {

        $this->signInAdmin();

        // Create a Group
        $group = (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];
        $node = (new CreateNodeAction)->execute($group, 'Cell_Gateway')['data'];
        $node = Node::find($node['node']['id']);

        $this->assertDatabaseHas('nodes', [
            'node_id' => 'Cell_Gateway',
            'group_id' => $group->id
        ]);

        // Delete the Node
        (new DeleteNodeAction)->execute($node);
    }

    public function test_that_a_node_must_have_no_devices_before_being_deleted()
    {
    }
}
