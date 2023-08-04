<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Auth\Actions;

use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Exception;
use GSSAPIContext;
use Illuminate\Support\Facades\Log;
use KRB5CCache;

class AuthenticateKerberosPrincipalAction
{
    public function execute(string $username, string $password)
    {
        if (!extension_loaded('krb5')) {
            ray('NO KRB');
            exit('KRB5 Extension not installed');
        }

        // Get a TGT for the user
        $ccache = new KRB5CCache;
        $flags = ['tkt_lifetime' => 3600];


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
            $clientContext = (new GSSAPIContext);
            $token = null;
            $clientContext->acquireCredentials($ccache);
            $clientContext->initSecContext(config('manager.manager_service_principal') . '@' . config('manager.domain'), null, 0, null, $token);

            //--------|
            // Server |
            //--------|

            $serverContext = (new GSSAPIContext);
            $serverContext->registerAcceptorIdentity('/config/keytab/keytab');
            $accepted = $serverContext->acceptSecContext($token);

            if (!$accepted) {
                throw new ActionFailException('Authentication failed');
            }
        }

        return action_success();
    }
}
