<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

use App\Domain\Devices\Models\Device;
use App\Domain\Groups\Models\Group;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Actions\GrantUserPermissionToAccessNodeAction;
use App\Domain\Nodes\Models\Node;
use Tests\TestCase;

class APITest extends TestCase
{
    // =======================================
    // Groups
    // =======================================

    /** @test */
    public function a_user_can_get_all_groups_for_nodes_that_they_have_access_to()
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

        $node = (new CreateNodeAction)->execute($group, 'My_Node');
        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        auth()->user()->update(
            [
                'administrator' => 0,
            ]
        );

        // Assert that the user can't see the group
        $this->getJson('/api/groups')->assertSuccessful()->assertDontSeeText('Test Group');

        // Assign the current user to have permission to see the 'Test Node' node.
        (new GrantUserPermissionToAccessNodeAction)->execute(auth()->user(), $node);

        // Assert that the user can now see the group
        auth()->user()->refresh();
        $this->getJson('/api/groups')->assertSuccessful()->assertSeeText('Test Group');
    }

    /** @test */
    public function administrators_can_get_all_groups()
    {
        $this->signInAdmin();

        Group::create(
            [
                'id' => 1,
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        Group::create(
            [
                'id' => 2,
                'name' => 'Test Group 2',
                'cluster_id' => 1,
            ]
        );

        // Assert that the admin can see the group
        $this->getJson('/api/groups')->assertSuccessful()->assertSeeText('Test Group')->assertSeeText('Test Group 2');
    }

    // =======================================
    // Nodes
    // =======================================

    /** @test */
    public function a_user_can_get_nodes_for_a_group_that_they_have_permission_to_view()
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

        $node = (new CreateNodeAction)->execute($group, 'Test Node');
        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        auth()->user()->update(
            [
                'administrator' => 0,
            ]
        );

        (new GrantUserPermissionToAccessNodeAction)->execute(auth()->user(), $node);

        $this->getJson('/api/groups/1/nodes')->assertSuccessful()->assertSeeText('Test Node');
    }

    /** @test */
    public function administrators_can_view_all_nodes()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => 1,
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        (new CreateNodeAction)->execute($group, 'Test Node');
        (new CreateNodeAction)->execute($group, 'Test Node 2');

        auth()->user()->refresh();

        // Assert that the administrator can see all nodes in the group
        $this->getJson('/api/groups/1/nodes')->assertSuccessful()->assertSeeText('Test Node')->assertSeeText('Test Node 2');
    }

    /** @test */
    public function users_can_only_see_nodes_that_they_have_permission_to_see_in_the_group()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => 1,
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'Test Node');
        (new CreateNodeAction)->execute($group, 'Test Node 2');

        (new GrantUserPermissionToAccessNodeAction)->execute(auth()->user(), Node::whereUuid($node['data']['node']['uuid'])->sole());

        auth()->user()->update(
            [
                'administrator' => false,
            ]
        );

        $this->getJson('/api/groups/1/nodes')->assertSuccessful()->assertSeeText('Test Node')->assertDontSeeText('Test Node 2');
    }

    // =======================================
    // Devices
    // =======================================

    // Getting Devices
    /** @test */
    public function a_user_can_get_devices_for_a_node_that_they_have_permission_to_view()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        $device = Device::create(
            [
                'id' => '1',
                'device_id' => 'Test Device',
                'node_id' => $node->id,
            ]
        );

        (new GrantUserPermissionToAccessNodeAction)->execute(auth()->user(), $node);

        auth()->user()->update([
            'administrator' => false,
        ]);

        $this->getJson('/api/groups/1/nodes/1/devices')
             ->assertSuccessful()
             ->assertSeeText('Test Device');
    }

    /** @test */
    public function users_can_only_see_devices_that_they_have_permission_to_see_in_the_node()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        $device = Device::create(
            [
                'id' => '1',
                'device_id' => 'Test Device',
                'node_id' => $node->id,
            ]
        );

        auth()->user()->update([
            'administrator' => false,
        ]);

        $this->getJson('/api/groups/1/nodes/1/devices')->assertStatus(401)->assertSeeText(
            'You do not have permission to view devices for this node.'
        );
    }

    /** @test */
    public function administrators_can_view_all_devices()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        $device = Device::create(
            [
                'id' => '1',
                'device_id' => 'Test Device',
                'node_id' => $node->id,
            ]
        );

        $this->getJson('/api/groups/1/nodes/1/devices')
             ->assertSuccessful()
             ->assertSeeText('Test Device');
    }

    // Creating Devices

    /** @test */
    public function users_who_have_permissions_to_access_the_node_can_create_new_devices()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        (new GrantUserPermissionToAccessNodeAction)->execute(auth()->user(), $node);

        auth()->user()->update([
            'administrator' => false,
        ]);

        $this->postJson(
            '/api/groups/1/nodes/1/devices',
            [
                'node_id' => $node->id,
            ]
        )->assertSuccessful();

        self::assertEquals(1, Device::count());
    }

    /** @test */
    public function users_who_do_not_have_permission_to_access_a_node_can_not_create_a_device_for_it()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        auth()->user()->update([
            'administrator' => false,
        ]);

        self::assertEquals(0, Device::count());

        $this->postJson(
            '/api/groups/1/nodes/1/devices',
            [
                'node_id' => $node->id,
            ]
        )->assertStatus(401);

        self::assertEquals(0, Device::count());
    }

    /** @test */
    public function administrators_can_create_devices_for_any_node()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        self::assertEquals(0, Device::count());

        $this->postJson(
            '/api/groups/1/nodes/1/devices',
            [
                'node_id' => $node->id,
            ]
        )->assertSuccessful();

        self::assertEquals(1, Device::count());
    }

    // Getting Device Info

    /** @test */
    public function users_who_have_permission_to_access_the_node_can_see_device_information_about_all_devices_in_the_node()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        Device::create(
            [
                'id' => '1',
                'device_id' => 'Test Device',
                'node_id' => $node->id,
            ]
        );

        (new GrantUserPermissionToAccessNodeAction)->execute(auth()->user(), $node);

        auth()->user()->update([
            'administrator' => false,
        ]);

        $response = $this->getJson(
            '/api/groups/1/nodes/1/devices/1'
        )->assertSuccessful()->assertJsonFragment(
            [
                'node_id' => 1,
                'device_id' => 'Test Device',
            ]
        );
    }

    /** @test */
    public function users_who_do_not_have_permission_to_access_the_node_can_not_see_device_information_about_any_devices_in_the_node()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        Device::create(
            [
                'id' => '1',
                'device_id' => 'Test Device',
                'node_id' => $node->id,
            ]
        );

        auth()->user()->update([
            'administrator' => false,
        ]);

        $this->getJson('/api/groups/1/nodes/1/devices/1')->assertStatus(404);
    }

    /** @test */
    public function administrators_can_see_device_information_about_all_devices()
    {
        $this->signInAdmin();

        $group = Group::create(
            [
                'id' => '1',
                'name' => 'Test Group',
                'cluster_id' => 1,
            ]
        );

        $node = (new CreateNodeAction)->execute($group, 'My_Node');

        $node = Node::whereUuid($node['data']['node']['uuid'])->sole();

        Device::create(
            [
                'id' => '1',
                'device_id' => 'Test Device',
                'node_id' => $node->id,
            ]
        );

        $this->getJson(
            '/api/groups/1/nodes/1/devices/1'
        )->assertSuccessful()->assertJsonFragment(
            [
                'node_id' => 1,
                'device_id' => 'Test Device',
            ]
        );
    }
}
