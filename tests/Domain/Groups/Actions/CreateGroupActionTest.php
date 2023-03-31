<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Groups\Actions;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Groups\Models\Group;
use Tests\TestCase;

class CreateGroupActionTest extends TestCase
{
    /** @test */
    public function it_performs_the_action()
    {
        self::assertEquals(0, Group::count());
        $this->signInAdmin();
        (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];

        $this->assertDatabaseHas('groups', [
            'name' => 'AMRC-TestGroup-1',
        ]);
    }
}
