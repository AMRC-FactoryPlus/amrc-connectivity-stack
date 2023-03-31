<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

use Tests\TestCase;

class CreateGroupTest extends TestCase
{
    /** @test */
    public function administrators_can_create_groups()
    {
        $this->withoutExceptionHandling();

        $payload = [
            'name' => 'AMRC-F2050-Test_Group',
            'cluster_id' => 1,
        ];

        $this->signInAdmin();
        $this->postJson('/api/groups/new', $payload)->assertSuccessful();

        $this->assertDatabaseHas('groups', $payload);
    }

    /** @test */
    public function non_administrators_can_not_create_groups()
    {
        $payload = ['name' => 'AMRC-F2050-Test_Group', 'cluster_id' => 1];

        $this->signIn();
        $this->postJson('/api/groups/new', $payload)->assertForbidden();

        $this->assertDatabaseMissing('groups', $payload);
    }

    /** @test */
    public function groups_must_abide_by_the_factory_plus_naming_convention()
    {
        $payload = ['name' => 'AMRC-F2050-Test Group', 'cluster_id' => 1];

        $this->signInAdmin();
        $this->postJson('/api/groups/new', $payload)->assertStatus(422)->assertSee('The name format is invalid.');

        $this->assertDatabaseMissing('groups', $payload);
    }
}
