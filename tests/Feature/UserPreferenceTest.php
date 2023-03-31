<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

use Tests\TestCase;

class UserPreferenceTest extends TestCase
{
    /** @test */
    public function a_user_can_get_a_preference()
    {
        $user = $this->signIn();
        $user->preferences = ['foo.bar' => 'baz'];
        $this->assertEquals('baz', $user->preference('foo.bar'));
        $this->assertNull($user->preference('foo.bae'));
    }

    /** @test */
    public function a_user_can_change_preferences()
    {
        $user = $this->signIn();
        $user->preferences = ['foo.bar' => 'baz'];
        $user->save();

        $this->assertEquals('world', $user->setPreference(['foo' => 'world'], false)->preference('foo'));
        $this->assertEquals('hello', $user->setPreference(['baz' => 'hello'], false)->preference('baz'));

        $this->assertEquals(['foo.bar' => 'baz'], $user->refresh()->preferences);
    }

    /** @test */
    public function a_user_can_change_and_save_preferences()
    {
        $user = $this->signIn();
        $user->preferences = ['foo.bar' => 'baz'];
        $user->save();

        $this->assertEquals('world', $user->setPreference(['foo.bar' => 'world'])->preference('foo.bar'));
        $this->assertEquals(['foo.bar' => 'world'], $user->refresh()->preferences);
    }

    /** @test */
    public function a_user_preference_refers_to_the_defaults_file_if_it_does_not_exist_in_the_users_preferences_column()
    {
        $user = $this->signIn();
        $this->assertEquals(false, $user->preference('appearance.colours.dark_mode'));

        $user->setPreference(['appearance.colours.dark_mode' => true]);
        $this->assertEquals(true, $user->fresh()->preference('appearance.colours.dark_mode'));
    }

    /** @test */
    public function a_user_can_reset_a_preference_to_a_default_value()
    {
        $user = $this->signIn();
        $this->assertEquals(false, $user->preference('appearance.colours.dark_mode'));
        $user->setPreference(['appearance.colours.dark_mode' => true]);
        $this->assertEquals(true, $user->fresh()->preference('appearance.colours.dark_mode'));
        $user->resetPreference('appearance.colours.dark_mode');
        $this->assertEquals(false, $user->fresh()->preference('appearance.colours.dark_mode'));
    }

    /** @test */
    public function a_user_preference_returns_null_if_it_does_not_exist_in_the_defaults_file_or_the_users_settings()
    {
        $user = $this->signIn();
        $this->assertEquals(null, $user->preference('nonexistent.preference'));
    }

    /** @test */
    public function a_user_can_get_a_preference_via_the_api()
    {
        $this->signIn();

        $result = $this->post('/api/user/get-preference', [
            'preference' => 'appearance.show_uuids',
        ]);
        $decoded = json_decode($result->getContent())->data;

        self::assertEquals(false, $decoded);
    }

    /** @test */
    public function a_user_can_get_all_preferences_via_the_api()
    {
        $this->signIn();
        $result = json_decode($this->get('/api/user/get-preferences')->getContent())->data;

        self::assertEquals(null, auth()->user()->preferences);
        self::assertEquals(false, $result->appearance->preferences->show_uuids->value);

        auth()->user()->setPreference(['appearance.show_uuids' => true]);

        $result = json_decode($this->get('/api/user/get-preferences')->getContent())->data;

        self::assertEquals(true, $result->appearance->preferences->show_uuids->value);
    }

    /** @test */
    public function a_user_can_set_a_preference_via_the_api()
    {
        $this->signIn();
        $result = json_decode($this->get('/api/user/get-preferences')->getContent())->data;

        self::assertEquals(null, auth()->user()->preferences);
        self::assertEquals(false, $result->appearance->preferences->show_uuids->value);

        $this->post('/api/user/set-preference', [
            'revisions' => ['appearance.show_uuids' => true],
        ]);

        $result = json_decode($this->get('/api/user/get-preferences')->getContent())->data;

        self::assertEquals(true, $result->appearance->preferences->show_uuids->value);
    }

    /** @test */
    public function a_user_can_reset_a_preference_to_the_default_value_via_the_api()
    {
        $this->signIn();
        $result = json_decode($this->get('/api/user/get-preferences')->getContent())->data;

        self::assertEquals(null, auth()->user()->preferences);
        self::assertEquals(false, $result->appearance->preferences->show_uuids->value);

        $this->post('/api/user/set-preference', [
            'revisions' => ['appearance.show_uuids' => true],
        ]);

        $result = json_decode($this->get('/api/user/get-preferences')->getContent())->data;

        self::assertEquals(true, $result->appearance->preferences->show_uuids->value);

        $this->post('/api/user/reset-preference', [
            'preference' => 'appearance.show_uuids',
        ]);

        $result = json_decode($this->get('/api/user/get-preferences')->getContent())->data;

        self::assertEquals(false, $result->appearance->preferences->show_uuids->value);
    }
}
