<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Support\Actions\GetJsonFromGithubAction;
use App\Http\Requests\GithubProxyRequest;

class GithubProxyController extends Controller
{
    public function get(GithubProxyRequest $request)
    {
        $validated = $request->validated();

        return process_action((new GetJsonFromGithubAction)->execute($validated['path']));
    }
}
