<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Groups\Models\Group;
use Carbon\Carbon;
use Tests\TestCase;

class CreateNodeTest extends TestCase
{
    /** @test */
    public function administrators_can_create_nodes()
    {
        $this->withoutExceptionHandling();

        $payload = [
            'name' => 'AMRC-F2050-Test_Group',
            'cluster_id' => 1,
        ];

        $this->signInAdmin();
        $this->postJson('/api/groups/new', $payload)
             ->assertSuccessful();

        $payload = [
            'enabled' => true,
            'node_id' => 'Cell_Gateway',
            'node_hostname' => 'lenTESTVALUE',
        ];
        $groupId = Group::first()->id;

        $this->signInAdmin();
        $this->postJson('/api/groups/' . $groupId . '/nodes/new', $payload)
             ->assertSuccessful();

        $this->assertDatabaseHas('nodes', [
            'node_id' => 'Cell_Gateway',
            'group_id' => $groupId,
        ]);
    }

    /** @test */
    public function non_administrators_can_not_create_nodes()
    {
        $payload = [
            'enabled' => true,
            'node_id' => 'Cell_Gateway',
            'node_hostname' => 'lenTESTVALUE',
        ];
        $this->signInAdmin();
        $group = (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];

        $this->signIn();
        $this->postJson('/api/groups/' . $group->id . '/nodes/new', $payload)
             ->assertForbidden();

        $this->assertDatabaseMissing('nodes', [
            'node_id' => 'Cell_Gateway',
            'group_id' => $group->id,
        ]);
    }

    /** @test */
    public function nodes_must_abide_by_the_factory_plus_naming_convention()
    {
        $this->signInAdmin();
        $group = (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];

        $payload = [
            'enabled' => true,
            'node_id' => 'Cell_Gateway Test',
        ];

        $this->signInAdmin();
        $this->postJson('/api/groups/' . $group->id . '/nodes/new', $payload)
             ->assertStatus(422)
             ->assertSee('The node id format is invalid.');

        $this->assertDatabaseMissing('nodes', [
            'node_id' => 'Cell_Gateway Test',
            'group_id' => $group->id,
        ]);
    }
}
