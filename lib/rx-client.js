/*
 * Factory+ client library, Rx version
 * Copyright 2024 University of Sheffield
 */

import { ServiceClient } from "@amrc-factoryplus/service-client";

import * as SI from "./interfaces.js";

/**
 * Extends ServiceClient with Rx operations
 *
 * This class extends ServiceClient from
 * @amrc-factoryplus/service-client. The service interfaces provide
 * additional functionality relying on rxjs.
 */
export class RxClient extends ServiceClient {
}

RxClient.define_interfaces(
    ["ConfigDB", SI.ConfigDB, ``],
);

/** @name RxClient#ConfigDB
 * ConfigDB extended service interface.
 * This property returns an Interfaces.ConfigDB object. This class
 * extends the base ConfigDB interface class from `service-client` with
 * additional methods for change-notify.
 */
