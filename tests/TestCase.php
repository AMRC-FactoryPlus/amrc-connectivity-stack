<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests;

use App\Domain\Users\Models\User;
use Faker\Factory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;
    use RefreshDatabase;

    /*
    >|-----------------------------------------
    >| Auth Helper Functions
    >|-----------------------------------------
    */

    protected function signIn($user = null)
    {
        $faker = Factory::create();

        $user = $user ?: User::create(
            [
                'username' => $faker->userName,
            ]
        );

        $this->actingAs($user, 'api');

        return $user;
    }

    protected function signInAdmin($user = null)
    {
        $faker = Factory::create();

        $user = $user ?: User::create(
            [
                'username' => $faker->userName,
                'administrator' => 1,
            ]
        );

        $this->actingAs($user, 'api');

        return $user;
    }
}
