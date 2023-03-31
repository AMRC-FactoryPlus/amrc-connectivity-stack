<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Preferences\Actions;

    use App\Domain\Preferences\Actions\GetAllPreferencesAction;
    use Tests\TestCase;

    class GetAllPreferencesActionTest extends TestCase
    {
        /**
         * @test
         */
        public function test()
        {
            $action = new GetAllPreferencesAction;
            $this->SignIn();
            self::assertTrue(array_key_exists('appearance', $action->execute()['data']));
        }
    }
