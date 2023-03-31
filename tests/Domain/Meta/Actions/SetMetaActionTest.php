<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Meta\Actions;

    use App\Domain\Meta\Actions\SetMetaAction;
    use Tests\TestCase;

    class SetMetaActionTest extends TestCase
    {
        /**
         * @test
         */
        public function test()
        {
            $action = new SetMetaAction;

            $this->SignIn();
            $this->assertEquals(true, auth()->user()->fresh()->meta('new_user'));
            $action->execute([
                'new_user' => false,
            ]);
            $this->assertEquals(false, auth()->user()->fresh()->meta('new_user'));
        }
    }
