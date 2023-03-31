<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Meta\Actions;

    use App\Domain\Meta\Actions\ResetMetaAction;
    use Tests\TestCase;

    class ResetMetaActionTest extends TestCase
    {
        /**
         * @test
         */
        public function test()
        {
            $action = new ResetMetaAction;

            $this->SignIn();
            auth()->user()->setMeta(['new_user' => false]);
            $this->assertEquals(false, auth()->user()->fresh()->meta('new_user'));
            $action->execute('new_user');
            $this->assertEquals(true, auth()->user()->fresh()->meta('new_user'));
        }
    }
