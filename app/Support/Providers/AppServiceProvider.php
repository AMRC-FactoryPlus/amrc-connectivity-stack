<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Support\Providers;

use AMRCFactoryPlus\ServiceClient;
use App\Exceptions\ReauthenticationRequiredException;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     *
     * @return void
     */
    public function register()
    {

        $this->app->singletonIf(ServiceClient::class, function (Application $app) {

            $ccache = new \KRB5CCache;

            // If the user is logged in then get their ccache
            // and use that for all future requests
            $ccache->open("FILE:/app/storage/".auth()->user()->username . '.ccache');

            // If the ccache has expired then re-authenticate by ending the session
            // and showing the login modal
            try {
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
