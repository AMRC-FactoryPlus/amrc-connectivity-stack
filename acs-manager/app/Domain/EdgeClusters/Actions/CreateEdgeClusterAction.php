<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\EdgeClusters\Actions;

use AMRCFactoryPlus\ServiceClient;
use AMRCFactoryPlus\UUIDs\App;
use AMRCFactoryPlus\UUIDs\Klass;
use App\Exceptions\ActionForbiddenException;

class CreateEdgeClusterAction
{

    /**
     * This action creates a new edge cluster
     **/

    public function execute(string $name, string $chart, bool $bare = false)
    {
        // =========================
        // Validate User Permissions
        // =========================

        if (!auth()->user()->administrator) {
            throw new ActionForbiddenException('Only administrators can create new edge clusters.');
        }

        // ===================
        // Perform the Action
        // ===================

        $fplus = resolve(ServiceClient::class);
        $configDB = $fplus->getConfigDB();

        // Create the object in the ConfigDB
        $uuid = $configDB->createObject(Klass::EdgeCluster, name: $name)['uuid'];

        $configDB->putConfig(App::Info, $uuid, [
            "name" => $name,
        ]);

        $cconf = [
            "chart" => $chart,
            "name" => $name,
            "namespace" => "fplus-edge",
        ];
        if ($bare) {
            $cconf["bare"] = true;
            $cconf["values"] = [
                "sealedSecrets" => ["enabled" => false],
            ];
        } 

        // Create an entry in the Edge Cluster Configuration app
        $configDB->putConfig(App::EdgeClusterConfiguration, $uuid, [
            'chart' => $chart,
            "name" => $name,
            "namespace" => 'fplus-edge',
        ]);

        return action_success();
    }

}
