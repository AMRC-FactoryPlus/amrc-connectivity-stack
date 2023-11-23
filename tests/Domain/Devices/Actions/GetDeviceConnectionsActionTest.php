<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Devices\Actions;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use App\Domain\Devices\Actions\ConfigureDeviceConnectionAction;
use App\Domain\Devices\Actions\CreateDeviceAction;
use App\Domain\Devices\Actions\CreateDeviceConnectionAction;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Models\Node;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class GetDeviceConnectionsActionTest extends TestCase
{
    /** @test */
    public function a_user_can_get_a_list_of_device_connections()
    {
        $this->withoutExceptionHandling();

        // Ensure that we don't actually upload any files to the bucket
        Storage::fake('device-configurations');
        Storage::fake('device-connections');


        $this->signInAdmin();

        // Create a Group
        $group = (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];
        $node = (new CreateNodeAction)->execute($group, 'Cell_Gateway')['data'];

        // Tell the system about the Smart Tool Schema, which will create an entry in the database for the schema and the version 1
        $deviceSchema = (new AddDeviceSchemaAction)->execute(
            schemaUrl: 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Cell/Protective_Stop-v1.json'
        )['data'];

        // Create a device
        $device = (new CreateDeviceAction)->execute(Node::whereNodeId('Cell_Gateway')->sole())['data'];

        // Create a device connection
        $connection = (new CreateDeviceConnectionAction)->execute($device->fresh()->load('node')->node)['data'];

        // Configure the device connection with a pre-written device connection
        (new ConfigureDeviceConnectionAction)->execute(
            deviceConnection: $connection->fresh()->load('node'),
            connectionConfiguration: file_get_contents(base_path('reference/protective_stop/device_connection.json')),
            device: $device,
        );

        // Assert that the user can get the connection for the device
        $response = $this->getJson('/api/groups/' . $group->id . '/nodes/' . $device->load('node')->node->id . '/connections')->assertSuccessful();
        $response = json_decode($response->getContent(), false, 512, JSON_THROW_ON_ERROR);
        self::assertCount(1, $response->data);

        self::assertNotNull($device->load('deviceConnection')->deviceConnection);
    }
}
