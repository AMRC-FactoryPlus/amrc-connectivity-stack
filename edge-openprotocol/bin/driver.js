/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { AsyncDriver } from '@amrc-factoryplus/edge-driver'
import { OpenProtocolHandler } from '../lib/openprotocol.js'

const drv = new AsyncDriver({
    env:        process.env,
    handler:    OpenProtocolHandler,
});
drv.run();
