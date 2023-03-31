<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Preferences\Actions;

    use App\Domain\Preferences\Actions\SetPreferenceAction;
    use Tests\TestCase;

    class SetPreferenceActionTest extends TestCase
    {
        /**
         * @test
         */
        public function test()
        {
            $action = new SetPreferenceAction;

            $this->signIn();
            self::assertFalse(auth()->user()->preference('appearance.show_uuids'));
            $action->execute(['appearance.show_uuids' => true]);
            self::assertTrue(auth()->user()->preference('appearance.show_uuids'));
        }
    }
