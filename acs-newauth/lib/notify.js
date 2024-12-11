/*
 * ACS Auth service
 * Notify provider
 * Copyright 2024 University of Sheffield AMRC
 */

import * as rxx                 from "@amrc-factoryplus/rx-util";
import { 
    Notify, WatchFilter, SearchFilter
}  from "@amrc-factoryplus/service-api";

export class AuthNotify extends Notify {
    build_handlers () {
        return [];
    }
}
