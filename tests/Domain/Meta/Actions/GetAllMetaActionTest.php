<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Meta\Actions;

use App\Domain\Meta\Actions\GetAllMetaAction;
use Tests\TestCase;

class GetAllMetaActionTest extends TestCase
{
    /**
     * @test
     */
    public function test()
    {
        $action = new GetAllMetaAction;

        $this->signIn();
        self::assertGreaterThan(1, count($action->execute()['data']));
    }
}
