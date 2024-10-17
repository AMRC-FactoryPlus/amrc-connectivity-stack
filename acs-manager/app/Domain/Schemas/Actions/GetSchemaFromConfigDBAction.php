<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2024 AMRC
 */

namespace App\Domain\Schemas\Actions;

use AMRCFactoryPlus\ServiceClient;
use App\Support\ManagerUUIDs;

class GetSchemaFromConfigDBAction
{
    /**
     * This action gets a schema from the ConfigDB. We do this as the
     * frontend doesn't have its own credentials.
     **/
    public function execute($uuid = null)
    {
        $cdb = resolve(ServiceClient::class)->getConfigDB();
        $schema = $cdb->getConfig(ManagerUUIDs::JsonSchema, $uuid);

        if ($schema)
            return action_success($schema);

        return action_fail(null, 404);
    }
}
