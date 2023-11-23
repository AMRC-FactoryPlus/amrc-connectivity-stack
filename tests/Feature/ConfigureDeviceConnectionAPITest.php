<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use App\Domain\Devices\Actions\ConfigureDeviceAction;
use App\Domain\Devices\Actions\CreateDeviceAction;
use App\Domain\Devices\Actions\CreateDeviceConnectionAction;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Nodes\Models\Node;
use Carbon\Carbon;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ConfigureDeviceConnectionAPITest extends TestCase
{
    /** @test */
    public function a_user_can_configure_a_device_connection_via_the_api()
    {
        // Ensure that we don't actually upload any files to the bucket
        Storage::fake('device-configurations');
        Storage::fake('device-connections');


        $this->signInAdmin();
        $this->withoutExceptionHandling();

        // Create a Group
        $group = (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];

        // Create a Cell Gateway node
        $payload = [
            'enabled' => true,
            'node_id' => 'Cell_Gateway',
            'node_hostname' => 'lenTESTVALUE',
            'expiry' => Carbon::now(),
        ];
        $this->postJson('/api/groups/' . $group->id . '/nodes/new', $payload)->assertSuccessful();

        // Tell the system about the Smart Tool Schema, which will create an entry in the database for the schema and the version 1
        $deviceSchema = (new AddDeviceSchemaAction)->execute(
            schemaUrl: 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Cell/Protective_Stop-v1.json'
        )['data'];

        // Create a device
        $device = (new CreateDeviceAction)->execute(Node::whereNodeId('Cell_Gateway')->sole())['data'];

        // Configure the device with a pre-written device configuration
        (new ConfigureDeviceAction)->execute(
            device                    : $device->fresh()->load('node.group', 'originMaps'),
            deviceSchema              : $deviceSchema->fresh(),
            version                   : $deviceSchema->versions()->whereVersion('1')->sole(),
            deviceConfiguration       : file_get_contents(base_path('reference/protective_stop/instance.json')),
            active                    : false
        );

        // Assert that the device has an inactive origin map
        self::assertEquals(0, $device->originMaps()->active()->count());
        self::assertNotNull($device->originMaps()->inactive()->first());
        self::assertNull($device->load('activeOriginMap')->activeOriginMap);

        // Set the device_id
        $this->patch('/api/devices/' . $device->id, [
            'device_id' => 'New_Name',
        ]);

        // Create a device connection
        $connection = (new CreateDeviceConnectionAction)->execute($device->load('node')->node->fresh())['data'];

        $connection->refresh();
        $device->refresh();

        $this->patchJson('/api/groups/' . $group->id . '/nodes/' . $device->node->id . '/connections/' . $connection->fresh()->id, [
            'configuration' => file_get_contents(base_path('reference/protective_stop/device_connection.json')),
            'device' => $device->id,
        ])->assertSuccessful();

        // Assert that the user can then get the config
        $this->getJson('/api/groups/' . $group->id . '/nodes/' . $device->node->id . '/connections/' . $connection->fresh()->id)->assertSuccessful()->assertSee(
            'Smart_Tool_Instance_Connection'
        );

        // Assert that the device has an active connection
        self::assertNotNull($device->fresh()->load('deviceConnection')->deviceConnection);
    }
}
