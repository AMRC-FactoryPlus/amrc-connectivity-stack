<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\FileService\Actions;

use App\Domain\Devices\Actions\CreateDeviceAction;
use App\Domain\FileService\Actions\GetDeviceFilesAction;
use App\Domain\Groups\Actions\CreateGroupAction;
use App\Domain\Nodes\Actions\CreateNodeAction;
use App\Domain\Nodes\Models\Node;
use Tests\TestCase;

class GetDeviceFilesActionTest extends TestCase
{
//    /**
//     * @test
//     */
//    public function it_can_get_the_uploaded_files() {
//        // it can get the available file types
//        $this->signInAdmin();
//        $group = (new CreateGroupAction())->execute('Test_Group')['data'];
//        (new CreateNodeAction())->execute($group, 'Cell_Gateway')['data'];
//        $device = (new CreateDeviceAction())->execute(Node::whereNodeId('Cell_Gateway')->sole())['data'];
//
//        $payload = (new GetDeviceFilesAction())->execute($device)['data'];
//
//        self::assertArrayHasKey('friendly_title', $payload);
//        self::assertArrayHasKey('enum_title', $payload);
//        self::assertArrayHasKey('mime_type', $payload);
//        self::assertArrayHasKey('tags', $payload);
//    }
}
