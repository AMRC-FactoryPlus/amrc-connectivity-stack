/*
 * ACS Data Access Service
 * UNS device structure: one whole device, read from the UNS bucket
 * Copyright 2026 University of Sheffield
 */

import { SparkplugSourcesHandler } from "./sparkplug-sources-handler.js";
import { DataAccess as Constants } from "./constants.js";

/* The same config as a Sparkplug source, `{ source }`, and the same
 * permission. The only differences are where the data is read from
 * and what a new one needs: its source must be a device with an ISA-95
 * placement, which is what puts the device on the UNS. */
export class UNSDeviceHandler extends SparkplugSourcesHandler {
  constructor(api){
    super(api);

    this.structure = Constants.App.UNSDevice;
    this.store = Constants.Store.UNS;
    this.replaced_by = null;
  }

  async check_source(config) {
    await this.api.check_uns_source(config.source);
  }
}
