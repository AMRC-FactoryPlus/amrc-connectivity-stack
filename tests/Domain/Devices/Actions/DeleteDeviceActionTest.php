<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Devices\Actions;

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
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Carbon\Carbon;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use function PHPUnit\Framework\assertEquals;
use function PHPUnit\Framework\assertNotNull;
use function PHPUnit\Framework\assertNull;

class DeleteDeviceActionTest extends TestCase
{
    public function test()
    {
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

        // Configure the device with a pre-written device configuration
        (new ConfigureDeviceAction)->execute(
            device: $device->fresh()->load('node.group', 'originMaps'),
            deviceSchema: $deviceSchema->fresh(),
            version: $deviceSchema->versions()->whereVersion('1')->sole(),
            deviceConfiguration: file_get_contents(base_path('reference/protective_stop/instance.json')),
            deviceConfigurationMetrics: '',
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

        // Assert that the device exists
        $this->assertDatabaseHas('devices', [
            'id' => $device->id,
        ]);

        // Delete the device
        (new DeleteDeviceAction)->execute($device);

        // Assert that the device no longer exists
        $this->assertDatabaseMissing('devices', [
            'id' => $device->id,
        ]);

        // Assert that there is still a device configurations in the database
        assertEquals(1, DeviceConnection::count());

        // Assert that there are no origin maps in the database
        assertEquals(0, OriginMap::count());

        // Assert that there is still an edge agent configuration in the database
        assertEquals(1, EdgeAgentConfiguration::count());

    }

    public function test_auth() {
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

        // Configure the device with a pre-written device configuration
        (new ConfigureDeviceAction)->execute(
            device: $device->fresh()->load('node.group', 'originMaps'),
            deviceSchema: $deviceSchema->fresh(),
            version: $deviceSchema->versions()->whereVersion('1')->sole(),
            deviceConfiguration: file_get_contents(base_path('reference/protective_stop/instance.json')),
            deviceConfigurationMetrics: '',
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

        // Assert that the device exists
        $this->assertDatabaseHas('devices', [
            'id' => $device->id,
        ]);

        $this->signIn();

        // Delete the device
        $exceptionFired = false;
        try {
            (new DeleteDeviceAction)->execute($device);
        } catch (ActionForbiddenException $e) {
            $exceptionFired = true;
            self::assertEquals('You do not have permission to delete devices for this node.', $e->getMessage());
        }
        self::assertTrue($exceptionFired);

        // Assert that the device still longer exists
        $this->assertDatabaseHas('devices', [
            'id' => $device->id,
        ]);

        // Assert that there is still a device configuration in the database
        assertEquals(1, DeviceConnection::count());

        // Assert that there is still the origin map in the database
        assertEquals(1, OriginMap::count());

        // Assert that there is still an edge agent configuration in the database
        assertEquals(1, EdgeAgentConfiguration::count());
    }
}
