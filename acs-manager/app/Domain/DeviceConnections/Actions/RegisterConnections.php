<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\DeviceConnections\Actions;

use AMRCFactoryPlus\ServiceClient;
use AMRCFactoryPlus\UUIDs;
use App\DeviceConnection;
use App\Domain\Devices\Models\Device;
use App\Domain\Nodes\Models\Node;
use App\Domain\Support\ManagerUUIDs;
use App\Exceptions\ActionFailException;
use App\Exceptions\ActionForbiddenException;
use Illuminate\Support\Facades\Log;

use function func_get_args;

function aget ($array, $key, $def) {
    return array_key_exists($key, $array) ? $array[$key] : $def;
}

function image_tag ($img) {
    return sprintf("%s/%s:%s",
        aget($img, "registry", ""),
        aget($img, "repository", ""),
        aget($img, "tag", ""));
}

class RegisterConnections
{
    public function execute()
    {
        // No auth, we run from the console
        //$this->authorise(...func_get_args());
        //$this->validate(...func_get_args());

        $fplus = resolve(ServiceClient::class);
        $this->cdb = $fplus->getConfigDB();

        Log::info("Locating Edge Deployments...");
        $this->find_deployments();
        Log::info("Registering Drivers...");
        $this->register_drivers();

        Log::info("Finished exporting Connections");
        return action_success();
    }

    private function find_deployments ()
    {
        $App = UUIDs\App::EdgeAgentDeployment;
        $deps = [];
        foreach (Node::all() as $node) {
            $uuid = $node->uuid;
            $deps[$uuid] = $this->cdb->getConfig($App, $uuid);
        }
        $this->deployments = $deps;
    }

    private function register_drivers ()
    {
        $DDef = ManagerUUIDs::DriverDef;
        $Driver = ManagerUUIDs::Driver;

        $cdb = $this->cdb;
        $uuids = $cdb->getConfig($DDef);
        $drivers = [];

        foreach ($uuids as $uuid) {
            $def = $cdb->getConfig($DDef, $uuid);
            if (!array_key_exists("image", $def))
                continue;
            $tag = image_tag($def["image"]);
            $drivers[$tag] = $uuid;
        }

        foreach ($this->deployments as $dep) {
            if (!$dep) continue;
            if (!array_key_exists("values", $dep) 
                    || !array_key_exists("image", $dep["values"]))
                continue;
            foreach ($dep["values"]["image"] as $image) {
                $tag = image_tag($image);
                if (array_key_exists($tag, $drivers))
                    continue;
                
                $name = aget($image, "repository", "(unknown driver)");
                $drv = $cdb->createObject($Driver, null, $name);
                $uuid = $drv["uuid"];
                $cdb->putConfig($DDef, $uuid, [ "image" => $image ]);
                $drivers[$tag] = $uuid;
                Log::info(sprintf("Registered driver %s as %s", $name, $uuid));
            }
        }

        $this->drivers = $drivers;
    }

    /**
     * This action sets the connection for a specific device
     **/
    private function authorise()
    {
        if ((! auth()->user()->administrator) && ! in_array(
            $deviceConnection->node->id,
            auth()
                ->user()
                ->accessibleNodes()
                ->get()
                ->pluck('id')
            ->all(),
            true
        )) {
            throw new ActionForbiddenException('Must be admin');
        }
    }

    private function validate()
    {
    }
}
