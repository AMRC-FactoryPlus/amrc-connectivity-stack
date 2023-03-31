<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Nodes\Actions;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Exceptions\ActionFailException;
use Tests\TestCase;

class CreateNodeActionTest extends TestCase
{
    /**
     * @test
     */
    public function it_prevents_multiple_cell_gateways_from_being_created_in_the_same_group()
    {
        $this->signInAdmin();

        // Create a Group
        $group = (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];
        (new CreateNodeAction)->execute($group, 'Cell_Gateway');

        $exceptionFired = false;
        try {
            (new CreateNodeAction)->execute($group, 'Cell_Gateway');
        } catch (ActionFailException $e) {
            $exceptionFired = true;
            self::assertEquals('This group already has a node with this name.', $e->getMessage());
        }
        self::assertTrue($exceptionFired);
    }
}
