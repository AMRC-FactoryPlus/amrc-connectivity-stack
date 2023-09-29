<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

use App\DeviceConnection;
use App\Domain\Clusters\Models\Cluster;
use App\Domain\DeviceConnections\Actions\AssignConnectionToDeviceAction;
use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use App\Domain\Devices\Actions\ConfigureDeviceConnectionAction;
use App\Domain\Devices\Actions\CreateDeviceAction;
use App\Domain\Devices\Actions\CreateDeviceConnectionAction;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Nodes\Models\Node;
use Carbon\Carbon;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

use function PHPUnit\Framework\assertCount;
use function PHPUnit\Framework\assertEquals;
use function PHPUnit\Framework\assertNotNull;
use function PHPUnit\Framework\assertNull;

class ConfigureDeviceTest extends TestCase
{
    /** @test */
    public function a_user_can_configure_a_device()
    {
        // a user can configure a device

        $this->withoutExceptionHandling();

        // Ensure that we don't actually upload any files to the bucket
        Storage::fake('device-configurations');
        Storage::fake('device-connections');
        Storage::fake('edge-agent-configs');

        $this->signInAdmin();

        // Create a Group
        $group = (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];

        // Create a Cell Gateway node
        $payload = [
            'is_gateway' => true,
            'enabled' => true,
            'node_id' => 'Cell_Gateway',
            'expiry' => Carbon::now(),
            'node_hostname' => 'lenTESTVALUE',
        ];
        $this->postJson('/api/groups/' . $group->id . '/nodes/new', $payload)
             ->assertSuccessful();

        // Tell the system about the Smart Tool Schema, which will create an entry in the database for the schema and the version 1
        $deviceSchema = (new AddDeviceSchemaAction)->execute(
            schemaUrl: 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Cell/Protective_Stop-v1.json'
        )['data'];

        // Create a device
        $device = (new CreateDeviceAction)->execute(
            Node::whereNodeId('Cell_Gateway')
                ->sole()
        )['data'];

        // |-------------------------------|
        // | First Tab: Device Information |
        // |-------------------------------|

        // Set the device_id
        $this->patch(
            '/api/devices/' . $device->id, [
                'device_id' => 'New_Name',
            ]
        );

        // Create a device connection
        $connection = (new CreateDeviceConnectionAction)->execute($device->load('node')->node->fresh())['data'];

        // |------------------------|
        // | Second Tab: Connection |
        // |------------------------|

        // Configure the device connection with a pre-written device connection
        (new ConfigureDeviceConnectionAction)->execute(
            deviceConnection: $connection->fresh()
                                         ->load('node'),
            connectionConfiguration: file_get_contents(base_path('reference/protective_stop/device_connection.json')),
            device: $device->fresh()
                           ->load('node.group', 'originMaps'),
        );

        // Assert that no edge agent config has been made because we don't yet have a connection configuration
        assertEquals(
            0,
            $device->fresh()
                   ->load('node')->node->edgeNodeConfigurations()
                                       ->count()
        );
        assertNull(
            $device->fresh()
                   ->load('node')->node->activeEdgeNodeConfiguration
        );

        // |--------------------------|
        // | Third Tab: Device Schema |
        // |--------------------------|

        // API logic:
        // -------------
        // Set the device_id
        $this->patchJson(
            '/api/devices/' . $device->id . '/origin-map', [
                'configuration' => file_get_contents(base_path('reference/protective_stop/instance.json')),
                'activate' => true,
                'device_schema_id' => $deviceSchema->id
            ]
        )
             ->assertSuccessful();

        // Assert that the device has an origin map saved in the filesystem against the device
        self::assertEquals(
            1,
            $device->originMaps()
                   ->active()
                   ->count()
        );
        self::assertNull(
            $device->originMaps()
                   ->inactive()
                   ->latest()
                   ->first()
        );
        self::assertNotNull(
            $device->fresh()
                   ->load('activeOriginMap')->activeOriginMap
        );

        // Assert that the device has a device connection saved in the filesystem against the device
        self::assertNotNull(
            $device->fresh()
                   ->load('deviceConnection')->deviceConnection
        );

        // Assert that a edge agent config has been made for the node
        assertEquals(
            1,
            $device->fresh()
                   ->load('node')->node->edgeNodeConfigurations()
                                       ->count()
        );
        assertNotNull(
            $device->fresh()
                   ->load('node')->node->activeEdgeNodeConfiguration
        );
    }

    /** @test */
    public function a_user_can_update_the_name_of_the_device()
    {
        $this->signInAdmin();
        $this->withoutExceptionHandling();

        // Create a Group
        $group = (new CreateGroupAction)->execute('AMRC-TestGroup-1', Cluster::first())['data'];

        // Create a Cell Gateway node
        $payload = [
            'is_gateway' => true,
            'enabled' => true,
            'node_id' => 'Cell_Gateway',
            'node_hostname' => 'lenTESTVALUE',
            'expiry' => Carbon::now(),
        ];
        $this->postJson('/api/groups/' . $group->id . '/nodes/new', $payload)
             ->assertSuccessful();

        // Create a device
        $device = (new CreateDeviceAction)->execute(
            Node::whereNodeId('Cell_Gateway')
                ->sole()
        )['data'];
        $device->refresh();
        assertNull($device->fresh()->device_id);

        $this->patch(
            '/api/devices/' . $device->id, [
                'device_id' => 'New_Name',
            ]
        );
        assertEquals('New_Name', $device->fresh()->device_id);
    }

    /**
     * @test
     */
    public function multiple_devices_can_use_the_same_connection()
    {
        $this->withoutExceptionHandling();

        // Ensure that we don't actually upload any files to the bucket
        Storage::fake('device-configurations');
        Storage::fake('device-connections');
        Storage::fake('edge-agent-configs');

        $this->signInAdmin();

        // Create a Group
        $group = (new CreateGroupAction)->execute('AMRC-AG-Test', Cluster::first())['data'];

        // Create a Cell Gateway node
        $payload = [
            'is_gateway' => true,
            'enabled' => true,
            'node_id' => 'Cell_Gateway',
            'expiry' => Carbon::now(),
            'node_hostname' => 'lenTESTVALUE',
        ];
        $this->postJson('/api/groups/' . $group->id . '/nodes/new', $payload)
             ->assertSuccessful();

        // Tell the system about the Protective Stop, which will create an entry in the database for the schema and the version 1
        $deviceSchema = (new AddDeviceSchemaAction)->execute(
            schemaUrl: 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Cell/Protective_Stop-v1.json'
        )['data'];

        // Create a device
        $device = (new CreateDeviceAction)->execute(
            Node::whereNodeId('Cell_Gateway')
                ->sole()
        )['data'];

        // |-------------------------------|
        // | First Tab: Device Information |
        // |-------------------------------|

        // Set the device_id
        $this->patch(
            '/api/devices/' . $device->id, [
                'device_id' => 'Device_1',
            ]
        );

        // Create a device connection
        $connection = (new CreateDeviceConnectionAction)->execute($device->load('node')->node->fresh())['data'];

        // |------------------------|
        // | Second Tab: Connection |
        // |------------------------|

        // Configure the device connection with a pre-written device connection
        (new ConfigureDeviceConnectionAction)->execute(
            device: $device->fresh()
                           ->load('node.group', 'originMaps'),
            deviceConnection: $connection->fresh()
                                         ->load('node'),
            connectionConfiguration: file_get_contents(base_path('reference/protective_stop/device_connection.json')),
        );

        // Assert that the device has a connection
        self::assertNotNull($device->deviceConnection());
        self::assertNull($device->load('activeOriginMap')->activeOriginMap);

        // Assert that no edge agent config has been made because we don't yet have a connection configuration
        assertEquals(
            0,
            $device->fresh()
                   ->load('node')->node->edgeNodeConfigurations()
                                       ->count()
        );
        assertNull(
            $device->fresh()
                   ->load('node')->node->activeEdgeNodeConfiguration
        );

        // API logic:
        // -------------
        // Set the device_id
        $this->patchJson(
            '/api/devices/' . $device->id . '/origin-map', [
                'configuration' => file_get_contents(base_path('reference/protective_stop/instance.json')),
                'activate' => true,
                'device_schema_id' => $deviceSchema->id
            ]
        )
             ->assertSuccessful();

        // Assert that the device has an origin map saved in the filesystem against the device
        self::assertEquals(
            1,
            $device->originMaps()
                   ->active()
                   ->count()
        );
        self::assertNull(
            $device->originMaps()
                   ->inactive()
                   ->latest()
                   ->first()
        );
        self::assertNotNull(
            $device->fresh()
                   ->load('activeOriginMap')->activeOriginMap
        );

        // Assert that the device has a device connection saved in the filesystem against the device
        self::assertNotNull(
            $device->fresh()
                   ->load('deviceConnection')->deviceConnection
        );

        // Assert that a edge agent config has been made for the node
        assertEquals(
            1,
            $device->fresh()
                   ->load('node')->node->edgeNodeConfigurations()
                                       ->count()
        );
        assertNotNull(
            $device->fresh()
                   ->load('node')->node->activeEdgeNodeConfiguration
        );

        $edgeAgentConfig = json_decode(
            \Storage::disk('edge-agent-configs')
                    ->get(
                        $device->fresh()
                               ->load('node')->node->edgeNodeConfigurations()
                                                   ->first()->file
                    )
        );

        assertCount(1, $edgeAgentConfig->deviceConnections);
        assertCount(1, $edgeAgentConfig->deviceConnections[0]->devices);

        // Do the same again but re-use the connection. Test it here and then get it working on the frontend

        assertEquals(1, DeviceConnection::count());

        // Create a device
        $device = (new CreateDeviceAction)->execute(
            Node::whereNodeId('Cell_Gateway')
                ->sole()
        )['data'];

        $device->fresh();

        // Set the device_id
        $this->patch(
            '/api/devices/' . $device->id, [
                'device_id' => 'Device_2',
            ]
        );

        (new AssignConnectionToDeviceAction)->execute(DeviceConnection::first(), $device);

        // API logic:
        // -------------
        // Set the device_id
        $this->patchJson(
            '/api/devices/' . $device->id . '/origin-map', [
                'configuration' => file_get_contents(base_path('reference/protective_stop/instance.json')),
                'activate' => true,
                'device_schema_id' => $deviceSchema->id
            ]
        )
             ->assertSuccessful();

        // Assert that the device has an origin map saved in the filesystem against the device
        self::assertEquals(
            1,
            $device->originMaps()
                   ->active()
                   ->count()
        );
        self::assertNull(
            $device->originMaps()
                   ->inactive()
                   ->latest()
                   ->first()
        );
        self::assertNotNull(
            $device->fresh()
                   ->load('activeOriginMap')->activeOriginMap
        );
        assertNotNull($device->device_connection_id);

        $edgeAgentConfig = json_decode(
            \Storage::disk('edge-agent-configs')
                    ->get(
                        $device->fresh()
                               ->load('node')->node->edgeNodeConfigurations()
                                                   ->latest()
                                                   ->first()->file
                    )
        );

        assertCount(1, $edgeAgentConfig->deviceConnections);
        assertCount(2, $edgeAgentConfig->deviceConnections[0]->devices);
    }
}
