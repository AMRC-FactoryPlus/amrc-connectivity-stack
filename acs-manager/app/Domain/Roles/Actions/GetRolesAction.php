<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Roles\Actions;

use App\Domain\AccessControls\Models\Role;
use Spatie\QueryBuilder\QueryBuilder;

class GetRolesAction
{
    /**
     * This action gets all roles in Factory+
     **/
    public function execute()
    {
        return action_success(QueryBuilder::for(Role::with('privileges'))->allowedFilters('is_principal'));
    }
}
