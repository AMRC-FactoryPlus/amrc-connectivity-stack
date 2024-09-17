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
            $validator->resolver()->registerProtocol("urn", function (Uri $uri) {
                Log::info(sprintf("Resolving schema [%s]: path [%s]",
                    $uri, $uri->path()));
                return null;
            });
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
