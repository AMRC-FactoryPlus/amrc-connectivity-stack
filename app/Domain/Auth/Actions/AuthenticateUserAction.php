<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Auth\Actions;

use App\Domain\Users\Models\User;

class AuthenticateUserAction
{
    /**
     * This action authenticates a user with Kerberos
     **/
    public function execute(string $username, string $password)
    {
        (new AuthenticateKerberosPrincipalAction)->execute($username, $password);

        // Get the local user with this username (null if they don't exist)
        $user = User::whereUsername($username . '@' . config('manager.realm'))->first();

        // If the user doesn't exist then create them
        if (! $user) {
            $user = User::create(
                [
                    'username' => $username . '@' . config('manager.realm'),
                ]
            );
        }

        // Log the user in
        return action_success($user);
    }
}
