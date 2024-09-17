<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Support\Providers;

use AMRCFactoryPlus\ServiceClient;
use App\Exceptions\ReauthenticationRequiredException;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;
use Opis\JsonSchema\Validator;
use Opis\JsonSchema\Uri;

const MetricSchema = "b16e85fb-53c2-49f9-8d83-cdf6763304ba";

class AppServiceProvider extends ServiceProvider
{

    /**
     * Register any application services.
     *
     * @return void
     */
    public function register()
    {
        // XXX bmz: I wonder if this should be ->scoped? This is a
        // per-request object, not a per-worker.
        $this->app->singletonIf(ServiceClient::class, function (Application $app) {
            $ccache = new \KRB5CCache;

            // If the ccache has expired then re-authenticate by ending the session
            // and showing the login modal
            try {
                // If the user is logged in then get their ccache
                // and use that for all future requests
                $ccache->open("FILE:/app/storage/ccache/" . auth()->user()->username . '.ccache');

                $ccache->isValid();
            } catch (\Exception $e) {
                // Throw a 'ReauthenticationRequiredException' to show the login dialog
                throw new ReauthenticationRequiredException('TGT has expired.');
            }

            return (new ServiceClient())
                ->setBaseUrl(config('manager.base_url'))
                ->setRealm(config('manager.realm'))
                ->setLogger($app->make('log'))
                ->setScheme(config('manager.scheme'))
                ->setCache($app->make('cache.store'))
                ->setCcache($ccache);
        });

        $this->app->singleton(Validator::class, function (Application $app) {
            $validator = new Validator;
            $configdb = $app->make(ServiceClient::class)->getConfigDB();
            $lookup = function (Uri $uri) use ($configdb) {
                $ok = preg_match("/^uuid:([-0-9a-f]{36})$/", 
                    $uri->path(), $match);
                if (!$ok) {
                    Log::warning("Unknown urn: schema ref: " . $uri->path());
                    return null;
                }
                /* XXX This uses the user's ServiceClient. In an ideal
                 * world this validator would persist beyond the scope
                 * of a single request, at which point we would need a
                 * ServiceClient using the Manager's own credentials. */
                $schema = $configdb->getConfig(MetricSchema, $match[1]);
                /* The ServiceClient returns JSON parsed into arrays.
                 * The Validator expects it parsed into objects. */
                $json = json_decode(json_encode($schema));
                Log::info("Fetched schema {uuid}: {schema}",
                    ["uuid" => $match[1], "schema" => $json]);
                return $json;
            };
            $validator->resolver()->registerProtocol("urn", $lookup);
            return $validator;
        });
    }

    /**
     * Bootstrap any application services.
     *
     * @return void
     */
    public function boot()
    {
        //
    }
}
