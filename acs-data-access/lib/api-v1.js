/*
* ACS Data Access Service
* APIv1
*/

import express from "express";
import { Map as IMap, Seq as ISeq, merge } from "immutable";
import * as rx from "rxjs";

import { ServiceError } from "@amrc-factoryplus/service-client";
import { DataAccess as Constants } from "./constants.js";
import { valid_uuid, valid_datetime, parse_download_filter } from "./validate.js";
import { fail, maxDate, minDate } from './utils.js';

import { SparkplugSourcesHandler } from "./sparkplug-sources-handler.js";
import { SessionLimitsHandler } from "./session-limits-handler.js";
import { UnionComponentsHandler } from "./unions-components-handler.js";
import {
  SeriesError, parse_request, merge_windows, cache_control,
  LIMITS as SeriesLimits,
} from "./series.js";
import { SeriesAbort } from "./series-reader.js";

export class APIv1 {
  constructor(opts) {
    this.data = opts.data;
    this.auth = opts.auth;
    this.cdb = opts.cdb;
    this.log = opts.debug.bound("apiv1");
    this.influxReader = opts.influxReader;
    this.seriesReader = opts.seriesReader;
    this.routes = this.setup_routes();
    this.handlers = {
      [Constants.App.SparkplugSrc]:
        new SparkplugSourcesHandler(this),

      [Constants.App.SessionLimits]:
        new SessionLimitsHandler(this),

      [Constants.App.UnionComponents]:
        new UnionComponentsHandler(this),
    };
  }

  setup_routes() {
    let api = express.Router();

    api.route("/metadata")
      .get(this.metadata_list.bind(this));

    api.route("/metadata/:uuid")
      .get(this.metadata_uuid.bind(this));
    
    api.route("/data/:uuid")
      .post(this.dataset_data.bind(this));

    api.route("/series")
      .post(this.series.bind(this));

    api.route("/structure")
      .get(this.structure_list.bind(this))
      .post(this.structure_create.bind(this));

    api.route("/structure/:uuid")
      .get(this.structure_uuid.bind(this))
      .put(this.structure_update.bind(this));

    api.route("/union-sources")
      .get(this.union_sources_list.bind(this));

    api.route("/session-sources")
      .get(this.session_sources_list.bind(this));

    api.route("/delete/:uuid")
      .get(this.delete_dataset.bind(this));

    return api;
  }


  _getHandler(structure) {
    const handler = this.handlers[structure];

    if (!handler)
      fail(this.log, 422, `Unknown structure ${structure}`);

    return handler;
  }


  /** Finds every dataset whose stored config points at the given dataset.
   *
   * Reads the structure apps straight from ConfigDB rather than using the
   * derived dataset map, so datasets that are currently invalid are still
   * checked. An invalid dataset keeps its config document, so it can still
   * be left holding a dangling reference.
   *
   * @param dataset_uuid The dataset that is about to be deleted.
   * @returns {Promise<Array<{dataset: string, structure: string}>>}
   */
  async find_referrers(dataset_uuid) {
    const referrers = [];

    for (const [structure, handler] of Object.entries(this.handlers)) {
      const configs = await rx.firstValueFrom(this.cdb.search_app(structure));
      if (!configs) continue;

      for (const [uuid, config] of configs) {
        if (uuid === dataset_uuid) continue;

        if (handler.references(config, dataset_uuid))
          referrers.push({ dataset: uuid, structure });
      }
    }

    return referrers;
  }

  /** GET. Deletes a dataset.
   *
   * Refuses with 409 while another dataset still references this one, and
   * returns the list of referrers so the caller can deal with them. See the
   * comment below for why we refuse rather than rewrite the referrers.
   */
  async delete_dataset(req, res){
    const dataset_uuid = req.params.uuid;
    if(!dataset_uuid) return fail(this.log, 422, `No req.params.uuid`);
    if(!valid_uuid(dataset_uuid)) return fail(this.log, 422, `Invalid uuid ${dataset_uuid}`);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.DeleteDataset,
      dataset_uuid,
      true,
    );

    if (!ok) return fail(this.log, 403, `You don't have DELETE permissions for ${dataset_uuid}`);

    this.log(`Delete dataset called by ${req.auth} for ${dataset_uuid}`);

    /* Refuse the delete while anything still points here.
     *
     * The alternative is to edit the referrers. We do not, for three
     * reasons. The caller holds DeleteDataset on this dataset only, so
     * editing other datasets would change data they may have no permission
     * to touch. A UnionComponents list can lose one entry and still mean
     * something, but a SessionLimits dataset is a time window over its
     * source, so removing the source leaves a window over nothing and there
     * is no sensible repair. And refusing writes nothing at all, so a failed
     * delete cannot leave the graph half updated.
     *
     * Callers delete from the top down: remove the union or session first,
     * then its components. */
    const referrers = await this.find_referrers(dataset_uuid);

    if (referrers.length > 0) {
      this.log(`Refusing to delete ${dataset_uuid}: referenced by %o`, referrers);

      return res.status(409).json({
        error: "dataset_in_use",
        dataset: dataset_uuid,
        message: `Dataset ${dataset_uuid} is still referenced by ${referrers.length} other dataset(s). Delete or update them first.`,
        referrers,
      });
    }

    /* Remove the links this dataset owns. The handler knows which way round
     * its links point: a union is the superclass of its components, a
     * session is a subclass of its source. */
    const datasets = await rx.firstValueFrom(this.data.datasets);
    const dataset = datasets.get(dataset_uuid);

    if (dataset?.config && this.handlers[dataset.structure]) {
      await this.handlers[dataset.structure]
        .remove_subclass_relationships(dataset_uuid, dataset.config);
    }

    // remove any remaining subclass relationships before deleting
    const subclasses = await this.cdb.class_direct_subclasses(dataset_uuid);
    if(subclasses){
      for(let s of subclasses){
        await this.cdb.class_remove_subclass(dataset_uuid, s);
      }
    }

    await this.cdb.delete_object(dataset_uuid);

    return res.status(200).json(dataset_uuid);
  }

  /** GET. Returns a list of Dataset UUIDs that the client has READ_DATASET access to.
   * The dataset can be optionally restricted by from and to dates (this is not implemented yet).
   * Dates must be in the format ISO date-time string in UTC 2025-11-13T09:33:18.000Z
   * @param from {date} (optional, inclusive) query param
   * @param to {date} (optional, inclusive) query param
   * Don't return invalid datasets
  */
  async metadata_list(req, res) {
    const uuids = await rx.firstValueFrom(this.data.allowed_valid_dataset_uuids(req.auth, Constants.Perm.ReadDataset));
    return res.status(200).json(uuids);
  }

  /** GET. Accepts Dataset UUID and returns metadata about a Published dataset.
   * @param uuid {request param}
   * @param 
   * @returns metadata - JSON object with properties:
                    * uuid {UUID} - Dataset UUID 
                    * name {string} - Dataset name from General Information 
                    * from {date} - Dataset starting bound - derived from bounds of dataset Sessions (if any) 
                    * to {date} - Dataset finishing bound - derived from bounds of dataset Sessions (if any)
                    * function {array} - Array of Functional classes - UUIDs of classes dataset belongs to (only members of Functional dataset type)
                    * metadata {object} - Map of metadata configs keyed by Application UUID - contains all config entries for dataset which use applications in the Dataset metadata class
                    * parts {array} - Subset datasets - contains UUIDs of all subclasses of dataset the client has READ access to.
    * Returns 404 if dataset is invalid.
   */
  async metadata_uuid(req, res){    
    const dataset_uuid  = req.params.uuid;
    if (!valid_uuid(dataset_uuid)) fail(this.log, 422, `${dataset_uuid} is invalid uuid.`);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.ReadDataset,
      dataset_uuid,
      true,
    );
    
    if (!ok) return fail(this.log, 403, `You don't have READ permissions for ${dataset_uuid}`);


    const [
      datasets,
      infos,
      all_f_types,
      all_metadata,
      parts
    ] = await Promise.all([
      rx.firstValueFrom(this.data.allowed_valid_datasets(req.auth, Constants.Perm.ReadDataset)),
      rx.firstValueFrom(this.data.general_infos),
      rx.firstValueFrom(this.data.functional_types),
      rx.firstValueFrom(this.data.metadata),
      rx.firstValueFrom(
        this.data.allowed_dataset_parts(dataset_uuid, req.auth, Constants.Perm.ReadDataset)
      )
    ]);

    const dataset = datasets.get(dataset_uuid);
    if(!dataset) return fail(this.log, 404, `Dataset ${dataset_uuid} is not found or invalid.`);
  
    const info = infos.get(dataset_uuid);

    const meta = {
      uuid: dataset_uuid,
      name: info?.name ? info.name : "UNKNOWN",
      from: dataset.from ? dataset.from : undefined,
      to: dataset.to ? dataset.to : undefined,
      function: all_f_types.get(dataset_uuid),
      metadata: all_metadata.get(dataset_uuid),
      parts
    }
    return res.status(200).json(meta);
  }





  async resolve_dataset( dataset_uuid, inherited_range = {from: null, to: null}, visited = new Set()){
    // prevent circular references
    if(visited.has(dataset_uuid)) return fail(this.log, 404, `Circular dataset reference detected ${dataset_uuid}`);

    visited.add(dataset_uuid);

    const datasets = await rx.firstValueFrom(this.data.datasets);
    const dataset = datasets.get(dataset_uuid);

    if(!dataset) return fail(this.log, 404, `Dataset not found ${dataset_uuid}`);

    const {structure, config} = dataset;
    
    if(!structure) return fail(this.log, 404, `Structure not found for dataset ${dataset_uuid}`);
    if(!valid_uuid(structure)) return (this.log, 404, `Structure uuid is invalid ${structure}`);
    if(structure === Constants.Special.InvalidDataset) return fail(this.log, 404, `Invalid dataset ${dataset_uuid}`);
    if(!config) return fail(this.log, 404, `Config not found for ${dataset_uuid}`);
    
    const handler = this._getHandler(structure);
    handler.validate_config(config);

    return await handler.resolve({
      dataset_uuid,
      dataset,
      config,
      inherited_range,
      visited,
    });
  }

  intersectRanges(parent, child){
    const from = maxDate(parent.from, child.from);
    const to = minDate(parent.to, child.to);

    if(from && to && new Date(from) > new Date(to)){
      return fail(this.log, 404, `Invalid intersected range. From: ${from} > to: ${to}`);
    }

    return {from, to};
  }


  /** POST. Queries all possible Influx suffixes, combines the measurements and returns actual data from a dataset.
   * Empty POST body requests all dataset measurements.
   *
   * Optional body fields (see docs/services/data-access.md):
   *   metrics - array of metric selectors. A selector containing `/` is a
   *     full Sparkplug metric path (`Folder/Sub/Name`) and matches only
   *     that metric at that path. A selector without `/` matches that
   *     metric name at any path. Names never include the Influx :x suffix.
   *   measurement - deprecated; a single exact Influx _measurement
   *     (including its :x suffix). Use metrics instead.
   * Invalid filters get a 422 with a JSON `{ error }` body.
   * @param {*} req 
   * @param {*} res 
   * @returns CSV with columns:
              * device - Device this data point comes from
              * metric - metric name (don't include Influx :x suffix)
              * timestamp - ISO string
              * value - actual data value
              * unit - Engineering unit (if available)
    * Don't return valid response if dataset is invalid
   */
  async dataset_data(req, res) {
    const dataset_uuid = req.params.uuid;

    if (!valid_uuid(dataset_uuid)) return fail(this.log, 422, `Invalid dataset uuid`);

    const { filter: meta, error } = parse_download_filter(req.body);
    if (error) {
      this.log(`Rejecting download of ${dataset_uuid}: ${error}`);
      return res.status(422).json({ error });
    }

    const ok = await this.auth.check_acl(
        req.auth,
        Constants.Perm.ReadDataset,
        dataset_uuid,
        true,
    );

    if (!ok) return fail(this.log, 403, `Unauthorised to read ${dataset_uuid}`);

    try {
        // Resolve dataset tree
        const resolved_sources = await this.resolve_dataset(dataset_uuid);

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${dataset_uuid}.csv"`
        );

        const csvStream = this.influxReader.exportDevices(resolved_sources, meta);

        csvStream.on("error", err => {
            this.log(err);
            res.destroy(err);
        });

        csvStream.pipe(res);

       }catch (err) {
        this.log(err);
        return fail(this.log, 500);
    }
  }


  /** POST. Bucketed data counts, metric means and last-data times for a
   * set of devices or one dataset, for timelines and charts.
   * See docs/services/data-access.md for the request and response.
   *
   * A dataset request needs ReadDataset on the dataset. A device request
   * needs UseSparkplug on each device: devices without it are listed in
   * `denied` and left out, and the request fails with 403 only when
   * every device is denied.
   */
  async series(req, res) {
    try {
      const parsed = parse_request(req.body);
      const as_of = Date.now();

      const scope = parsed.dataset
        ? await this.series_dataset_scope(req.auth, parsed)
        : await this.series_device_scope(req.auth, parsed);

      /* `mean` and `last` entries inherit the check of their device. */
      const run = {
        ...parsed,
        mean: parsed.mean.filter(m => scope.windows.has(m.device)),
      };

      const result = await this.series_run(res, run, scope.windows, as_of);
      if (!result) return;

      const iso = t => new Date(t).toISOString();
      const devices = {};
      for (const [device, windows] of scope.windows) {
        const out = {};
        if (parsed.dataset)
          out.windows = windows.map(([a, b]) => [iso(a), iso(b)]);
        if (parsed.count)
          out.count = result.counts.get(device) ?? [];
        if (parsed.last)
          out.last = result.last.get(device) ?? null;
        devices[device] = out;
      }

      res.set("Cache-Control", cache_control(parsed, as_of));
      return res.status(200).json({
        from: iso(parsed.from),
        to: iso(parsed.to),
        every: parsed.every,
        asOf: iso(as_of),
        source: "raw",
        devices,
        metrics: result.metrics,
        denied: scope.denied,
      });
    }
    catch (err) {
      if (err instanceof SeriesError) {
        this.log(`Series request refused: ${err.message}`);
        return res.status(err.status).json(err.body());
      }
      throw err;
    }
  }

  /** Permission and windows for a dataset request. Reading a dataset
   * grants reading its devices within the dataset's windows. */
  async series_dataset_scope(principal, parsed) {
    const ok = await this.auth.check_acl(
      principal,
      Constants.Perm.ReadDataset,
      parsed.dataset,
      true,
    );
    if (!ok) return fail(this.log, 403, `Unauthorised to read ${parsed.dataset}`);

    const sources = await this.resolve_dataset(parsed.dataset);

    const by_device = new Map();
    for (const s of sources) {
      if (!by_device.has(s.device_uuid)) by_device.set(s.device_uuid, []);
      by_device.get(s.device_uuid).push(s);
    }

    if (by_device.size > SeriesLimits.devices)
      throw new SeriesError(413, "too_many_devices",
        `The dataset has more than ${SeriesLimits.devices} devices.`,
        { limit: SeriesLimits.devices });

    const stray = parsed.mean.find(m => !by_device.has(m.device));
    if (stray)
      throw new SeriesError(422, "invalid_request",
        `"mean" device ${stray.device} is not in the dataset.`);

    const windows = new Map();
    for (const [device, list] of by_device)
      windows.set(device, merge_windows(list, parsed.from, parsed.to));

    return { windows, denied: [] };
  }

  /** Permission and windows for a device request. One ACL lookup gives
   * a predicate that honours root and wildcard grants. */
  async series_device_scope(principal, parsed) {
    const allowed = await rx.firstValueFrom(
      this.data.watch_allowed(principal, Constants.Perm.UseSparkplug));

    const windows = new Map();
    const denied = [];
    for (const device of parsed.devices) {
      if (allowed(device))
        windows.set(device, [[parsed.from, parsed.to]]);
      else
        denied.push(device);
    }

    if (!windows.size)
      return fail(this.log, 403, `No UseSparkplug permission on any requested device`);

    return { windows, denied };
  }

  /** Runs the series queries under the timeout, and aborts them if the
   * client goes away. Returns undefined if the client has gone. */
  async series_run(res, parsed, windows, as_of) {
    const ctl = this.seriesReader.controller();
    const on_close = () => {
      if (!res.writableEnded) ctl.abort(new SeriesAbort("client closed"));
    };
    res.on("close", on_close);

    try {
      return await this.seriesReader.run(parsed, windows, as_of, ctl.signal);
    }
    catch (err) {
      const reason = ctl.signal.aborted ? ctl.signal.reason?.reason : null;
      if (reason == "timeout")
        return fail(this.log, 504, `Series query timed out`);
      if (reason == "client closed") {
        this.log(`Series client went away; queries cancelled`);
        return;
      }

      /* Cancel the sibling queries of the one that failed. */
      ctl.abort(new SeriesAbort("failed"));

      /* A 4xx from InfluxDB means we sent a bad query: that is our bug. */
      if (err?.name == "HttpError" && err.statusCode < 500) {
        this.log("Series query rejected by InfluxDB: %s", err.message);
        return fail(this.log, 500, `Series query failed`);
      }
      if (err?.name == "HttpError" || err?.name == "RequestTimedOutError"
          || typeof err?.code == "string") {
        this.log("InfluxDB unavailable: %s", err.message);
        return fail(this.log, 503, `InfluxDB unavailable`);
      }
      throw err;
    }
    finally {
      ctl.done();
      res.off("close", on_close);
    }
  }

  /** GET. 
   * 
   * @param {*} req 
   * @param {*} res 
   * @returns list of dataset UUIDs the client has permission to EDIT
   * the response includes invalid datasets 
   */
  async structure_list(req, res){
    const uuids = await rx.firstValueFrom(this.data.allowed_all_dataset_uuids(req.auth, Constants.Perm.EditDataset));
    return res.status(200).json(uuids);
  }

  /** GET. Returns a list of valid Dataset UUIDs the client has INCLUDE_IN_UNION
   * access to, i.e. those datasets the client is permitted to embed as a
   * component of a Union dataset. This is a distinct permission from
   * READ_DATASET/EDIT_DATASET visibility.
   */
  async union_sources_list(req, res){
    const uuids = await rx.firstValueFrom(this.data.allowed_valid_dataset_uuids(req.auth, Constants.Perm.IncludeInUnion));
    return res.status(200).json(uuids);
  }

  /** GET. Returns a list of valid Dataset UUIDs the client has USE_FOR_SESSION
   * access to, i.e. those datasets the client is permitted to use as the
   * source of a Session dataset. This is a distinct permission from
   * READ_DATASET/EDIT_DATASET visibility.
   */
  async session_sources_list(req, res){
    const uuids = await rx.firstValueFrom(this.data.allowed_valid_dataset_uuids(req.auth, Constants.Perm.UseForSession));
    return res.status(200).json(uuids);
  }

  /** GET. Fetches structural definition of dataset
   * Requires EDIT permission on the dataset
   * READONLY clients can't see this structure
   * If dataset is structurally INVALID -> Special UUID (structurally invalid dataset) and absent config
   * @param {*} req 
   * @param {*} res 
   * @returns object:
      * uuid {UUID} - Dataset UUID
      * class {UUID} - Structural class: Sparkplug device, Union Dataset, Session
      * config {any} - Structural definition: "not visible", Union components, Session limits
  * the response includes invalid datasets but their structure field references Invalid Dataset uuid
   */
  async structure_uuid(req, res) {
    const dataset_uuid = req.params.uuid;
    if (!valid_uuid(dataset_uuid)) return fail(this.log, 422, `Dataset uuid ${dataset_uuid} is invalid.`);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.EditDataset,
      dataset_uuid,
      true,
    );

    if (!ok) return fail(this.log, 403, `You don't have permission to Edit dataset ${dataset_uuid}.`);

    const dataset = await rx.firstValueFrom(
      this.data.allowed_all_datasets(req.auth, Constants.Perm.EditDataset).pipe(
        rx.map(datasets => datasets.get(dataset_uuid))
      )
    );

    if (!dataset) return fail(this.log, 404, `Dataset not found for ${dataset_uuid}.`);
    const {from, to, ...def} = dataset;
    return res.status(200).json(def);
  } 
  

  /** Checks a proposed config without writing anything.
   *
   * Runs the structure's own validation and the source permission
   * checks. Throws a 422 or 403 APIError if the config is not
   * acceptable. Call this before removing or changing any existing state,
   * so that a rejected request leaves the dataset exactly as it was.
   *
   * @returns The handler for the structure.
   */
  async _check_dataset_config(principal, structure, config) {
    const handler = this._getHandler(structure);
    handler.validate_config(config);

    const ok = await handler.check_sources_permissions(principal, config);
    if(!ok) return fail(this.log, 403, `You don't have permission for source(s) in config.`);

    return handler;
  }

  /** Writes a dataset config and its subclass relationships.
   *
   * This only writes. The caller must have checked the config with
   * `_check_dataset_config` first.
   */
  async _write_dataset_config(structure, config, dataset_uuid){ 
    const handler = this._getHandler(structure);

    // Create new Dataset object
    if(!dataset_uuid){
      dataset_uuid = await this.cdb.create_object(Constants.Class.Dataset);
      this.log("Created new dataset object in ConfigDB", dataset_uuid);
    }

    // Create config entry for the dataset object
    await this.cdb.put_config(structure, dataset_uuid, config);
    this.log(`Added config for ${dataset_uuid}`);

    await handler.create_subclass_relationships(dataset_uuid, config);
    this.log(`Created subclass relationship for ${dataset_uuid}`);
    
    return dataset_uuid;
  }

  
  /** POST. Creates a new dataset. 
   * 
   * @param {*} req.body must be object (structure, config) without uuid.
   * @param {*} res 
   * @returns new dataset's UUID - JSON string 
   */

  async structure_create(req, res){
    const {structure, config} = req.body;

    if(!structure) return fail(this.log, 422, `Structure not provided in request body.`);
    if(!valid_uuid(structure)) return fail(this.log, 422, `Structure uuid ${structure} is invalid.`);

    if(!config) return fail(this.log, 422, `Config not provided in request body.`);
    this._getHandler(structure).validate_config(config);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.CreateDataset,
      structure,
      true
    );
    if (!ok) return fail(this.log, 403, `You don't have Create permission for structure ${structure}`);

    await this._check_dataset_config(req.auth, structure, config);
    const dataset_uuid = await this._write_dataset_config(
      structure,
      config,
      null
    );

    return res.status(200).json(dataset_uuid);
  }


  /** PUT. Updates dataset definition. Principal should have CreateDataset permission
   * 
   * @param {*} req.body must be object (structure, config) and UUID (optional)
   * @param {*} res 
   */
  /*
    For VALID dataset:
    Don't let changing the structure type only config. So, if request.body.structure != dataset.structure then return 409. 
    Remove all subclass relationships between dataset and its current config sources
    Add subclass relationships between datasets and its new config sources

    For INVALID dataset:
    Remove config entries for this dataset from all structure apps and ignore 404
    Don't remove any existing subclass relationships -> Completely ignore existing subclass relationships for Invalid ones.
    Add subclass relationship between dataset and its new config source
  */

  async structure_update(req, res){
    const dataset_uuid = req.params.uuid;
    if(!dataset_uuid) return fail(this.log, 422, `Dataset uuid not provided`);
    if(!valid_uuid(dataset_uuid)) return fail(this.log, 422, `Invalid uuid ${dataset_uuid}`);

    const structure = req.body.structure;
    if(!structure) return fail(this.log, 422, `Structure not provided`);
    if(!valid_uuid(structure)) return fail(this.log, 422, `Structure uuid is invalid`);

    const new_config = req.body.config;
    if(!new_config) return fail(this.log, 422, `Config not provided`);

    this._getHandler(structure).validate_config(new_config);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.EditDataset,
      dataset_uuid,
      true
    );
    if (!ok) return fail(this.log, 403, `You don't have Edit permission for dataset ${dataset_uuid}`);

    const datasets = await rx.firstValueFrom(this.data.allowed_all_datasets(req.auth, Constants.Perm.EditDataset));
    const dataset = datasets.get(dataset_uuid);
    if(!dataset) return fail(this.log, 404, `Dataset ${dataset_uuid} not found.`);

    const current_structure = dataset.structure;
    const current_config = dataset.config; 
    const is_valid = current_structure !== Constants.Special.InvalidDataset;

    if(is_valid && current_structure != structure)
      return fail(this.log, 409, `Changing structure type is not allowed (current: ${current_structure}, new: ${structure})`); 

    /* Check the new config completely before removing anything. Every
     * rejection (422, 403) must happen here, so a rejected update leaves
     * the old config and subclass relationships in place. */
    const handler = await this._check_dataset_config(req.auth, structure, new_config);

    // for currently VALID dataset
    if(is_valid){
      // remove all subclass relationships with current config sources
      await handler.remove_subclass_relationships(dataset_uuid, current_config)
    }
    // For currently INVALID dataset
    else{
      // delete configs for all other structures; a 404 means that
      // structure had no entry, and any other error stops the update
      const all_structure_apps = Object.values(Constants.App);

      for(const s of all_structure_apps){
        await this.cdb.delete_config(s, dataset_uuid)
          .catch(ServiceError.check(404));
      }
    } 

    const objectUuid = await this._write_dataset_config(
      structure,
      new_config,
      dataset_uuid,
    );

    if(!objectUuid){
      return fail(this.log, 500, `Failed to update dataset ${dataset_uuid}`);
    }
 
    return res.status(200).json(objectUuid);
  }
}
