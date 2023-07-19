/* ACS initial service setup
 * Copyright 2023 AMRC
 */

import { ServiceClient, UUIDs } from "@amrc-factoryplus/utilities";

const fplus = await new ServiceClient({env: process.env}).init();

const ping = await fplus.ConfigDB.ping();
console.log("ConfigDB: %o", ping);
