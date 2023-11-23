<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

use App\Domain\Clusters\Models\Cluster;
use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use App\Domain\Devices\Actions\ConfigureDeviceAction;
use App\Domain\Devices\Actions\ConfigureDeviceConnectionAction;
use App\Domain\Devices\Actions\CreateDeviceAction;
use App\Domain\Devices\Actions\CreateDeviceConnectionAction;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Models\Node;
use App\Domain\OriginMaps\Actions\ActivateOriginMapAction;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

use function PHPUnit\Framework\assertEquals;
use function PHPUnit\Framework\assertNotNull;
use function PHPUnit\Framework\assertNull;

class GetEdgeAgentApplicationConfigTest extends TestCase
{
    /** @test */
    public function ane_edge_agent_app_can_get_its_config()
    {
        // Ensure that we don't actually upload any files to the bucket
        Storage::fake('device-configurations');
        Storage::fake('device-connections');
        //

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

        // Configure the device with a pre-written device configuration
        (new ConfigureDeviceAction)->execute(
            device: $device->fresh()->load('node.group', 'originMaps'),
            deviceSchema: $deviceSchema->fresh(),
            version: $deviceSchema->versions()->whereVersion('1')->sole(),
            deviceConfiguration: file_get_contents(base_path('reference/protective_stop/instance.json')),
            active: false
        );

        // Assert that the device has an inactive origin map
        self::assertEquals(0, $device->originMaps()->active()->count());
        self::assertNotNull($device->originMaps()->inactive()->first());
        self::assertNull($device->load('activeOriginMap')->activeOriginMap);

        // Create a device connection
        $connection = (new CreateDeviceConnectionAction)->execute(Node::find($node['node']['id']))['data'];

        // Configure the device connection with a pre-written device connection
        (new ConfigureDeviceConnectionAction)->execute(
            device: $device->fresh()->load('node.group', 'originMaps'),
            deviceConnection: $connection->fresh()->load('node'),
            connectionConfiguration: file_get_contents(base_path('reference/protective_stop/device_connection.json')),
        );

        // Give the device a name (device_id)
        $this->patchJson(
            '/api/devices/' . $device->id,
            [
                'device_id' => 'Test_Device',
            ]
        );

        // Assert that the device has the new device_id
        self::assertEquals('Test_Device', $device->fresh()->device_id);

        // Assert that no edge agent config has been made because we don't yet have a connection configuration
        assertEquals(0, $device->fresh()->load('node')->node->edgeNodeConfigurations()->count());
        assertNull($device->fresh()->load('node')->node->activeEdgeNodeConfiguration);

        // Activate the origin map
        (new ActivateOriginMapAction)->execute(
            $device->originMaps()->with('device.node')->inactive()->latest()->first()
        );

        // Assert that the device has an origin map saved in the filesystem against the device
        self::assertEquals(1, $device->originMaps()->active()->count());
        self::assertNull($device->originMaps()->inactive()->latest()->first());
        self::assertNotNull($device->fresh()->load('activeOriginMap')->activeOriginMap);

        // Assert that a edge agent config has been made for the node
        assertEquals(1, $device->fresh()->load('node')->node->edgeNodeConfigurations()->count());
        assertNotNull($device->fresh()->load('node')->node->activeEdgeNodeConfiguration);

        // Ideally we'd test that we can fetch the config over the API here but we'd end up mocking the Kerberos
        // credentials, which could get messy

        $this->postJson(
            '/api/edge-agent-config',
            [
                'node_id' => $node['node']['uuid'],
                'config_password' => 'wrongPassword',
            ]
        )->assertForbidden();
    }
}
