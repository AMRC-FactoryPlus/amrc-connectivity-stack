<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Preferences\Actions;

    use App\Domain\Preferences\Actions\GetPreferenceAction;
    use Tests\TestCase;

    class GetPreferenceActionTest extends TestCase
    {
        /**
         * @test
         */
        public function test()
        {
            $action = new GetPreferenceAction;
            $this->SignIn();

            self::assertFalse($action->execute('appearance.show_uuids')['data']);
        }
    }
