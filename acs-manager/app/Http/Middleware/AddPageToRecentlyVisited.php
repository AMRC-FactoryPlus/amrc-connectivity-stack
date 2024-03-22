<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Middleware;

use App\Http\Support\RecentPages;
use Closure;

class AddPageToRecentlyVisited
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return mixed
     */
    public function handle($request, Closure $next, $pageName)
    {
        RecentPages::storePageInCache($pageName);

        return $next($request);
    }
}
