<?php
/* ACS Manager
 * Well-known UUIDs
 * Copyright 2025 University of Sheffield AMRC
 */

namespace App\Domain\Support;

# XXX These are not organised properly. I don't really want to create a
# whole lot of classes just for these... 
class ManagerUUIDs {
    # Classes
    const Connection =          "f371cbfc-de3e-11ef-b361-7b31622bc42f";
    const Driver =              "3874e06c-de4a-11ef-a68c-0f1c2d4d555c";

    # Apps
    const ConnConfig =          "fa8b429c-de3e-11ef-87fd-6382f0eac944";
    const DriverDef =           "454e5bec-de4a-11ef-bfea-4bc400f636a5";

    # Edge Agent internal drivers
    const REST =                  "c9f5c6ac-de4d-11ef-befa-ef66bbfc8926";
    const MTConnect =             "e8c74c90-de4d-11ef-ad96-6b885f1e8b5d";
    const EtherNetIP =            "eefce570-de4d-11ef-95e6-379190194ffa";
    const S7 =                    "f171a296-de4d-11ef-aef4-cf4e4ac2bfc6";
    const OPCUA =                 "f32fed40-de4d-11ef-a011-1711bd498427";
    const MQTT =                  "f4789ae4-de4d-11ef-9de4-ab74010e5ff5";
    const Websocket =             "f5fa94ee-de4d-11ef-882f-a7f7c2ad5273";
    const UDP =                   "f76120f0-de4d-11ef-baeb-4b617561ae1d";
    # Stock in-cluster drivers
    const Bacnet =                "bdc64178-de4c-11ef-b15e-3711aef7cf9b";
    const Modbus =                "c355a44e-de4c-11ef-8a5a-e31f3872ed79";
    const Test =                  "c8798cba-de4c-11ef-8a43-8766e8683af8";
    const TPlinkSmartPlug =       "d46e1374-de4c-11ef-b469-c388a038fd5c";
    # Fallback external driver
    const ExternalDriver =        "eb669a2c-e213-11ef-998e-a7fc6f4817b5";
}

?>
