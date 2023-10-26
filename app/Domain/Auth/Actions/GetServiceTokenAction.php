<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Auth\Actions;

use App\Exceptions\ActionErrorException;
use App\Exceptions\ActionFailException;
use ErrorException;
use GSSAPIContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use KRB5CCache;

/**
 * GSSAPI and KRB5 functions are poorly documented but can be parsed here:
 *
 * https://github.com/pierrejoye/php-krb5/tree/master/php5
 *
 * $gssapi->registerAcceptorIdentity();
 * $gssapi->acquireCredentials();
 * $gssapi->inquireCredentials();
 * $gssapi->initSecContext();
 * $gssapi->acceptSecContext();
 * $gssapi->getMic();
 * $gssapi->verifyMic();
 * $gssapi->wrap();
 * $gssapi->unwrap();
 * $gssapi->getTimeRemaining();
 * $ccache->initPassword();
 * $ccache->initKeytab();
 * $ccache->getName();
 * $ccache->getPrincipal();
 * $ccache->getRealm();
 * $ccache->getLifetime();
 * $ccache->getEntries();
 * $ccache->open();
 * $ccache->save();
 * $ccache->isValid();
 * $ccache->getTktAttrs();
 * $ccache->renew();
 */
class GetServiceTokenAction
{
    /**
     * This action ensures that a valid krb token exists in the cache for use when talking to other services and returns it.
     **/
    public function execute(string $service, $forceRefresh = false)
    {
        if (!extension_loaded('krb5')) {
            throw new ActionErrorException('KRB5 Extension not installed');
        }

        // Get the current TGT or ask for a new one
        $ccache = new \KRB5CCache;

        // ! This is returning a 502 to the browser but may be a red herring. Kills the process when running in a terminal.
        $ccache->initKeytab('sv1manager@' . config('manager.domain'), config('manager.keytab_path'));

        $ccache->save('FILE:' . storage_path('/app/cc.ccache'));

        // If the cache doesn't have a krb_token_<$service>_service then get one
        if (!Cache::has('krb_token_' . $service . '_service') || $forceRefresh) {
            Log::debug('Refreshing token for service', ['service' => $service,]);

            $clientContext = (new GSSAPIContext);
            $token = null;

            /**
             * Here we save to disk and then re-open again. This is to solve a head-scratcher that AG and BM spent a long time trying to solve.
             * Failed: GSSAPIContext:acquireCredentials(): No credentials were supplied, or the credentials were unavailable or inaccessible (458752,39756033)
             */
            try {
                $ccache2 = (new KRB5CCache);
                $ccache2->open('FILE:' . storage_path('/app/cc.ccache'));

                //                    Log::debug('Acquiring credentials using loaded ccache2 from disk', [
                //                        'service' => $service,
                //                        'ccache'  => [
                //                            'name'              => $ccache2->getName(),
                //                            'principal'         => $ccache2->getPrincipal(),
                //                            'realm'             => $ccache2->getRealm(),
                //                            'lifetime'          => $ccache2->getLifetime(),
                //                            'entries'           => $ccache2->getEntries(),
                //                            'valid'             => $ccache2->isValid(),
                //                            'ticket_attributes' => $ccache2->getTktAttrs(),
                //                        ],
                //                    ]);

                $clientContext->acquireCredentials($ccache2);
            } catch (ErrorException $e) {
                Log::error($e->getMessage());
                throw new ActionFailException($e->getMessage());
            }

            Log::debug('Initialising security context', ['service' => $service, 'context' => 'HTTP/' . $service . '.' . config('manager.service_domain') . '@' . config('manager.domain'), 'token' => $token,]);

            $clientContext->initSecContext('HTTP/' . $service . '.' . config('manager.service_domain') . '@' . config('manager.domain'), null, 0, null, $token // <- Can only use once
            );

            Log::debug('Authorising against service', ['service' => $service, 'token' => $token, 'auth_header' => ('Negotiate ' . base64_encode($token)), 'endpoint' => config('manager.service_scheme') . '://' . $service . '.' . config('manager.service_domain') . '/token',

                ]);

            // Make HTTP request to service to an Authorise (Negotiate) header (to /token)
            $response = Http::withHeaders(['Authorization' => ('Negotiate ' . base64_encode($token)),])->post(config('manager.service_scheme') . '://' . $service . '.' . config('manager.service_domain') . '/token');

            $returnToken = json_decode($response->body(), false, 512, JSON_THROW_ON_ERROR);

            Log::debug('Service authorisation successful', ['service' => $service, 'token' => $returnToken->token,]);

            // Add to cache under krb_token_$service_service with lifetime
            Cache::put('krb_token_' . $service . '_service', $returnToken->token, Carbon::createFromTimestampMs($returnToken->expiry));
        }

        // Return token
        return action_success(Cache::get('krb_token_' . $service . '_service'));
    }
}
