<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Auth\Actions;

use App\Domain\Users\Models\User;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Exception;
use Illuminate\Support\Facades\Log;

class AuthenticateUserAction
{
    /**
     * This action authenticates a user with Kerberos
     **/
    public function execute(string $username, string $password)
    {
        // Check if the KRB5 extension is loaded
        if (!extension_loaded('krb5')) {
            ray('NO KRB');
            exit('KRB5 Extension not installed');
        }

        // Get a TGT for the user
        $ccache = new \KRB5CCache;
        $flags = ['tkt_life' => config('manager.tkt_life', 21600)];

        // Check if the login was successful
        try {
            $ccache->initPassword($username, $password, $flags);
        } catch (Exception $e) {
            Log::info('Authentication failed for ' . $username, [
                'message' => $e->getMessage(),
            ]);
            throw new ActionForbiddenException('Authentication failed');
        }

        if (config('app.env') !== 'local') {
            // Validate the service (we act as both the client and the server here)
            //--------|
            // Client |
            //--------|

            // Initialise the GSSAPI with the ccache and initialise the context
            $clientContext = (new \GSSAPIContext);
            $token = null;
            $clientContext->acquireCredentials($ccache);
            $clientContext->initSecContext(
                config('manager.manager_service_principal') . '@' . config('manager.realm'),
                null,
                0,
                null,
                $token
            );

            //--------|
            // Server |
            //--------|

            $serverContext = (new \GSSAPIContext);
            $serverContext->registerAcceptorIdentity('/config/keytab/keytab');
            $accepted = $serverContext->acceptSecContext($token);

            if (!$accepted) {
                throw new ActionFailException('Authentication failed');
            }
        }

        // Get the local user with this username (null if they don't exist)
        $user = User::whereUsername($username . '@' . config('manager.realm'))->first();

        // If the user doesn't exist then create them
        if (!$user) {
            $user = User::create(
                [
                    'username' => $username . '@' . config('manager.realm'),
                ]
            );
        }

        // At this point we have a valid ccache for the user. Store
        // the cache to disk using the user's full principal as the
        // filename, replacing the @ with a - to avoid issues with
        $ccache->save("FILE:/app/storage/" . $user->username . '.ccache');

        // Log the user in
        return action_success($user);
    }
}
