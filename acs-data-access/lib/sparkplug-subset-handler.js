/*
 * ACS Data Access Service
 * Sub-device structure: chosen metrics from one Sparkplug device
 * Copyright 2026 University of Sheffield
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

import {BaseStructureHandler} from './base-structure-handler.js';
import { fail } from './utils.js';
import { valid_uuid } from "./validate.js";
import { DataAccess as Constants } from "./constants.js";
import { walk_origin_map, resolve_metric } from "./origin-map.js";

export const MAX_METRICS = 500;

/* A metric path relative to its instance: non-empty segments separated
 * by single slashes. */
const METRIC_rx = /^[^/]+(\/[^/]+)*$/;

export class SparkplugSubsetHandler extends BaseStructureHandler {
  constructor(api){
    super(api);

    this.structure = Constants.App.SparkplugSubset;
    this.sourcePermission = Constants.Perm.UseSparkplug;
  }

  /* config is { source, metrics: [{ instance, metric }] }. `instance` is
   * the Instance_UUID of the metric's nearest enclosing object (the device
   * UUID for metrics with none) and `metric` is the path from that object
   * to the metric, without a type suffix. */
  validate_config(config) {
    if(!config)
      return fail(this.log, 422, `config not provided`);

    if(!valid_uuid(config.source))
      return fail(this.log, 422, `config.source uuid is invalid.`);

    const { metrics } = config;
    if(!Array.isArray(metrics) || metrics.length == 0)
      return fail(this.log, 422, `config.metrics must be a non-empty array for SparkplugSubset structure.`);

    if(metrics.length > MAX_METRICS)
      return fail(this.log, 422, `config.metrics has ${metrics.length} entries; the maximum is ${MAX_METRICS}.`);

    const seen = new Set();
    for(const ref of metrics){
      if(!valid_uuid(ref?.instance))
        return fail(this.log, 422, `metric instance ${ref?.instance} is invalid UUID`);

      if(typeof ref.metric != "string" || !METRIC_rx.test(ref.metric))
        return fail(this.log, 422, `metric path ${ref.metric} is invalid`);

      const key = `${ref.instance}/${ref.metric}`;
      if(seen.has(key))
        return fail(this.log, 422, `metric ${key} is listed twice`);
      seen.add(key);
    }
  }

  async check_sources_permissions(principal, config) {
    const target = config.source;
    if(!target) return fail(this.log, 422, `Dataset definition does not contain source.`);

    if(!valid_uuid(target)) return fail(this.log, 422, `Source uuid ${target} is invalid.`);

    return await this.auth.check_acl(
      principal,
      this.sourcePermission,
      target,
      true
    );
  }

  /* Resolves each reference through the device's current origin map. A
   * reference whose instance has gone (usually after a schema change)
   * reads nothing; it must never widen the read to the whole device. */
  async resolve({ dataset_uuid, config, inherited_range }) {
    const device = config.source;
    const info = await this.cdb.get_config(UUIDs.App.DeviceInformation, device);
    const { instances } = walk_origin_map(info?.originMap, device);

    const metrics = [];
    for (const ref of config.metrics) {
      const resolved = resolve_metric(instances, ref);
      if (resolved)
        metrics.push(resolved);
      else
        this.log(`Dataset ${dataset_uuid}: instance ${ref.instance} is not in the origin map of ${device}; skipping ${ref.metric}`);
    }

    return [{
      dataset_uuid,
      device_uuid: device,
      metrics,
      from: inherited_range.from,
      to: inherited_range.to,
    }];
  }

  /* A SparkplugSubset points at a device, not at another dataset, so it
   * can never hold a dangling dataset reference. */
  references() {
    return false;
  }

  async create_subclass_relationships() {
    return;
  }

  async remove_subclass_relationships() {
    return;
  }
}
