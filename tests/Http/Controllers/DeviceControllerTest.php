<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Http\Controllers;

use App\DeviceConnection;
use App\Domain\Clusters\Models\Cluster;
use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use App\Domain\Devices\Actions\ConfigureDeviceAction;
use App\Domain\Devices\Actions\ConfigureDeviceConnectionAction;
use App\Domain\Devices\Actions\CreateDeviceAction;
use App\Domain\Devices\Actions\CreateDeviceConnectionAction;
use App\Domain\Devices\Actions\DeleteDeviceAction;
use App\Domain\Devices\Actions\UpdateDeviceInformationAction;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Models\Node;
use App\Domain\OriginMaps\Actions\ActivateOriginMapAction;
use App\Domain\OriginMaps\Models\OriginMap;
use App\EdgeAgentConfiguration;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use function PHPUnit\Framework\assertEquals;

class DeviceControllerTest extends TestCase
{

    public function testIndex()
    {

    }

    public function testUpdate()
    {

    }

    public function testStore()
    {

    }

    public function testShow()
    {

    }

    public function testDestroy()
    {
        // Ensure that we don't actually upload any files to the bucket
        Storage::fake('device-configurations');
        Storage::fake('device-connections');
        Storage::fake('edge-agent-configs');

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
            deviceConfigurationMetrics: '',
            active: false
        );

        // Create a device connection
        $connection = (new CreateDeviceConnectionAction)->execute(Node::find($node['node']['id']))['data'];

        // Configure the device connection with a pre-written device connection
        (new ConfigureDeviceConnectionAction)->execute(
            deviceConnection: $connection->fresh()->load('node'),
            connectionConfiguration: file_get_contents(base_path('reference/protective_stop/device_connection.json')),
            device: $device->fresh()->load('node.group', 'originMaps'),
        );

        // Give the device a name (device_id)
        (new UpdateDeviceInformationAction)->execute($device->load('node'), 'Test_Device');

        // Activate the origin map
        (new ActivateOriginMapAction)->execute(
            $device->originMaps()->with('device.node')->inactive()->latest()->first()
        );

        $this->deleteJson('/api/devices/' . $device->id)
            ->assertStatus(200);
    }
}
