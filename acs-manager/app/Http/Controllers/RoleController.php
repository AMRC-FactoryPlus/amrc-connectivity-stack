<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Roles\Actions\GetRolesAction;

class RoleController extends Controller
{
    public function index()
    {
        return process_action((new GetRolesAction)->execute());
    }
}
