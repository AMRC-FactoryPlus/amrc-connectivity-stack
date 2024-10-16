<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Schemas\Actions;

use AMRCFactoryPlus\ServiceClient;
use App\Support\ManagerUUIDs;

class GetDeviceSchemasAction
{
    /**
     * This action gets all schema types registered in the application
     **/
    public function execute($searchTerm = null)
    {
        $cdb = resolve(ServiceClient::class)->getConfigDB();

        $keys = ["name", "version"];

        /* This endpoint isn't wrapped in php-service-client yet. Using
         * search for this is a bit of a hack; properly we should call
         * /app/SchemaInfo and then iterate over all the objects. But,
         * REST principles aside, we don't get any cache benefit as we
         * aren't using an HTTP library with a cache... */
        $schemas = $cdb->fetch(
            type:   "get",
            url:    "v1/app/" . ManagerUUIDs::SchemaInfo . "/search",
            query:  array_combine(
                array_map(fn ($k) => "@" . $k, $keys), $keys),
        );

        /* array_merge_recursive nearly does what we want but merges
         * right down to the bottom level. */
        $mangled = [];
        foreach ($schemas as $uuid => $info) {
            $name = $info["name"];
            $mangled[$name] ??= [];
            $mangled[$name][] = [
                "uuid"      => $uuid,
                ...array_combine(
                    $keys, array_map(fn ($k) => $info[$k], $keys)),
            ];
        }

        return action_success($mangled);
    }
}
