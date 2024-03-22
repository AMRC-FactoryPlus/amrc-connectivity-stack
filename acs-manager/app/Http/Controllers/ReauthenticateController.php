<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Auth\Actions\AuthenticateUserAction;
use App\Http\Requests\ReauthenticateRequest;
use Illuminate\Http\Request;

class ReauthenticateController extends Controller
{
    public function reauthenticate(ReauthenticateRequest $request)
    {
        $validated = $request->validated();

        (new AuthenticateUserAction())->execute($validated['username'], $validated['password']);
    }
}
