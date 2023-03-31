<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Domain\Preferences\Actions;

use App\Domain\Preferences\Actions\ResetPreferenceAction;
use Tests\TestCase;

class ResetPreferenceActionTest extends TestCase
{
    /**
     * @test
     */
    public function test()
    {
        $this->signIn();
        self::assertFalse(auth()->user()->preference('appearance.show_uuids'));
        auth()->user()->setPreference([
            'appearance.show_uuids' => true,
        ]);
        self::assertTrue(auth()->user()->preference('appearance.show_uuids'));

        (new ResetPreferenceAction)->execute('appearance.show_uuids');

        self::assertFalse(auth()->user()->preference('appearance.show_uuids'));
    }
}
