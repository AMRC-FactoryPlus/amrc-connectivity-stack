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
use Illuminate\Support\Facades\Storage;

use function func_get_args;

function aget ($array, $key, $def = null) {
    if (is_null($array))
        return $def;
    return array_key_exists($key, $array) ? $array[$key] : $def;
}

function image_tag ($img) {
    return sprintf("%s/%s:%s",
        aget($img, "registry", ""),
        aget($img, "repository", ""),
        aget($img, "tag", ""));
}

# This is awful. But I can't see how to create a constant lookup table
# in PHP...
function internal_driver ($connType) {
    switch ($connType) {
    case "REST":
        return ["uuid" => ManagerUUIDs::REST, "details" => "RESTConnDetails"];
    case "MTConnect": 
        return ["uuid" => ManagerUUIDs::MTConnect, "details" => "MTConnectConnDetails"];
    case "EtherNet/IP": 
        return ["uuid" => ManagerUUIDs::EtherNetIP, "details" => "EtherNetIPConnDetails"];
    case "S7": 
        return ["uuid" => ManagerUUIDs::S7, "details" => "s7ConnDetails"];
    case "OPC UA": 
        return ["uuid" => ManagerUUIDs::OPCUA, "details" => "OPCUAConnDetails"];
    case "MQTT": 
        return ["uuid" => ManagerUUIDs::MQTT, "details" => "MQTTConnDetails"];
    case "Websocket": 
        return ["uuid" => ManagerUUIDs::Websocket, "details" => "WebsocketConnDetails"];
    case "UDP": 
        return ["uuid" => ManagerUUIDs::UDP, "details" => "UDPConnDetails"];
    default:
        throw sprintf("Unknown internal connType %s", $connType);
    }
}

function stock_driver ($img) {
    switch ($img) {
    case "bacnet":              return ManagerUUIDs::Bacnet;
    case "modbus":              return ManagerUUIDs::Modbus;
    case "test":                return ManagerUUIDs::Test;
    case "tplink-smartplug":    return ManagerUUIDs::TPlinkSmartPlug;
    default:                    return null;
    }
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
        Log::info("Locating/registering Drivers...");
        $this->register_drivers();
        Log::info("Registering Connections...");
        $this->register_connections();

        Log::info("Finished exporting Connections");
        return action_success();
    }

    private function find_deployments ()
    {
        $App = UUIDs\App::EdgeAgentDeployment;
        $deps = [];
        foreach (Node::all() as $node) {
            $uuid = $node->uuid;
            $dep = $this->cdb->getConfig($App, $uuid);
            $deps[$uuid] = $dep;

            $host = aget($dep, "hostname");
            if ($node->hostname != $host) {
                $node->hostname = $host;
                $node->save();
            }
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

    private function find_driver ($conn, $values, $dvals)
    {
        if ($conn["connType"] != "Driver")
            return internal_driver($conn["connType"]);

        # If we can't find deployment info, assume this is a
        # cluster-external driver.
        $ext = ["uuid" => ManagerUUIDs::ExternalDriver, "details" => "DriverDetails"];
        $img = aget($dvals, "image");
        if (is_null($img))
            return $ext;

        $image = aget(aget($values, "image"), $img);
        if (is_null($image)) {
            $stock = stock_driver($img);
            if (is_null($stock))
                return $ext;
            else
                return ["uuid" => $stock, "details" => "DriverDetails"];
        }

        $tag = image_tag($image);
        $driver = aget($this->drivers, $tag, ManagerUUIDs::ExternalDriver);
        return ["uuid" => $driver, "details" => "DriverDetails"];
    }

    private function deployment_config ($values, $dvals)
    {
        # This is the only way to get an empty JSON object...
        $deployment = new \stdClass();
        $ddevs = aget($values, "driverDevices");
        $dmnts = aget($dvals, "deviceMounts");
        
        if (!is_null($ddevs) && !is_null($dmnts)) {
            $dmap = [];
            foreach ($dmnts as $tag => $cdev) {
                $hdev = aget($ddevs, $tag);
                if (is_null($hdev)) continue;
                $dmap[] = ["source" => $hdev, "mount" => $cdev];
            }
            $deployment->devices = $dmap;
        }

        return $deployment;
    }

    private function connection_config ($dconn, $node)
    {
        $conn = json_decode(
            Storage::disk('device-connections')->get($dconn->file), 
            true, 512, JSON_THROW_ON_ERROR);

        $dep = aget($this->deployments, $node->uuid);
        $values = aget($dep, "values");
        $dvals = aget(aget($values, "drivers"), $dconn->name);

        $driver = $this->find_driver($conn, $values, $dvals);
        $deployment = $this->deployment_config($values, $dvals);

        $topo = ["cluster" => $node->cluster];
        if (!is_null($node->hostname))
            $topo["hostname"] = $node->hostname;

        return [
            "driver"        => $driver["uuid"],
            "edgeAgent"     => $node->uuid,
            "topology"      => $topo,
            "deployment"    => $deployment,
            "config"        => aget($conn, $driver["details"], new \stdClass()),
            "source"        => [
                "payloadFormat" => aget($conn, "payloadFormat"),
            ],
        ];
    }

    private function register_connections ()
    {
        foreach (DeviceConnection::all() as $dconn) {
            $node = Node::find($dconn->node_id);

            if (is_null($node) || is_null($dconn->file)) {
                Log::info(sprintf("Connection %s of %s is incomplete, skipping",
                    $dconn->name, $node ? $node->uuid : "???"));
                continue;
            }
            Log::info(sprintf("Registering Connection %s of %s",
                $dconn->name, $node->uuid));

            $cconf = $this->connection_config($dconn, $node);
            $dconn->update([
                "driver"        => $cconf["driver"],
                "deployment"    => json_encode($cconf["deployment"]),
            ]);
        }
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
