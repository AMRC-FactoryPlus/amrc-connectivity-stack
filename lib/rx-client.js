/*
 * Factory+ client library, Rx version
 * Copyright 2024 University of Sheffield
 */

import { ServiceClient } from "@amrc-factoryplus/service-client";

import * as SI from "./interfaces.js";

export class RxClient extends ServiceClient {
}

RxClient.define_interfaces(
    ["ConfigDB", SI.ConfigDB, ``],
);
