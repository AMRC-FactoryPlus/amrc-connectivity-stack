/*
 * ACS Data Access Service
 * UNS device metrics structure: chosen metrics of one device, read
 * from the UNS bucket
 * Copyright 2026 University of Sheffield
 */

import { SparkplugSubsetHandler } from "./sparkplug-subset-handler.js";
import { DataAccess as Constants } from "./constants.js";

/* The same config as a Sub-device, `{ source, metrics }`, with the
 * same choice of metrics: those of the origin map recorded to the
 * historian. Metric paths stay relative to the device; the UNS path
 * prefix is only added when the Flux is built. */
export class UNSDeviceMetricsHandler extends SparkplugSubsetHandler {
  constructor(api){
    super(api);

    this.structure = Constants.App.UNSDeviceMetrics;
    this.store = Constants.Store.UNS;
    this.replaced_by = null;
  }

  async check_source(config) {
    await this.api.check_uns_source(config.source);
  }
}
