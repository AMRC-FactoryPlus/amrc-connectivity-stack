<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Meta\Actions;

use App\Domain\Meta\Actions\GetMetaAction;
use Tests\TestCase;

class GetMetaActionTest extends TestCase
{
    /**
     * @test
     */
    public function test()
    {
        $action = new GetMetaAction;

        $this->SignIn();
        self::assertTrue($action->execute('new_user')['data']);
    }
}
