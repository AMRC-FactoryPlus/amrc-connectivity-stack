<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Devices\Actions;

use App\DeviceSchema;
use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use App\Exceptions\ActionFailException;
use Tests\TestCase;

class AddDeviceSchemaActionTest extends TestCase
{
    /** @test */
    public function it_creates_a_new_device_schema()
    {
        $this->signInAdmin();

        (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Smart_Tool/Smart_Tool-v1.json');

        $this->assertDatabaseHas('device_schemas', [
            'name' => 'Smart_Tool/Smart_Tool',
            'url' => 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Smart_Tool/Smart_Tool',
        ]);
    }

    /** @test */
    public function it_can_create_a_new_version()
    {
        // it can create a new version

        //$this->withoutExceptionHandling();

        $this->signInAdmin();
        (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Smart_Tool/Smart_Tool-v1.json');
        (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Smart_Tool/Smart_Tool-v0.json');

        self::assertEquals(1, DeviceSchema::count());
        self::assertEquals(2, DeviceSchema::first()->versions()->count());
    }

    /** @test */
    public function it_can_not_create_a_duplicate_version()
    {
        $this->signInAdmin();
        (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Smart_Tool/Smart_Tool-v1.json');
        self::assertEquals(1, DeviceSchema::count());
        self::assertEquals(1, DeviceSchema::first()->versions()->count());
        $exceptionFired = false;
        try {
            (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Smart_Tool/Smart_Tool-v1.json');
        } catch (ActionFailException $e) {
            $exceptionFired = true;
            self::assertEquals(
                'A device schema with this name and this version already exists. If you are updating this schema be sure to give it a new version number and try again.',
                $e->getMessage()
            );
        }
        self::assertTrue($exceptionFired);

        self::assertEquals(1, DeviceSchema::count());
        self::assertEquals(1, DeviceSchema::first()->versions()->count());
    }
}
