<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

use App\Domain\Devices\Actions\AddDeviceSchemaAction;
use Tests\TestCase;

class GetSchemasTest extends TestCase
{
    /** @test */
    public function a_user_can_get_a_list_of_all_device_schemas()
    {
        $this->signInAdmin();
        (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Smart_Tool/Smart_Tool-v1.json');

        $this->signIn();
        $this->getJson('/api/device-schemas')->assertSuccessful()->assertSeeText('Smart_Tool\/Smart_Tool');
    }

    /** @test */
    public function a_user_can_get_a_list_of_all_versions_for_a_given_device_schema()
    {
        $this->withoutExceptionHandling();
        $this->signInAdmin();
        $schema = (new AddDeviceSchemaAction)->execute('https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Smart_Tool/Smart_Tool-v1.json')['data'];

        $this->signIn();
        $this->getJson('/api/device-schemas')->assertSuccessful()->assertSeeText('Smart_Tool\/Smart_Tool');
        $this->getJson('/api/device-schemas/' . $schema->id . '/versions')->assertSuccessful()->assertSeeText('1');
    }
}
