/*
* ACS Data Access Service
* APIv1
*/

import express from "express";
import { Map as IMap, Seq as ISeq } from "immutable";
import * as rx from "rxjs";

import { APIError } from "@amrc-factoryplus/service-api";
import { ServiceError } from "@amrc-factoryplus/service-client";
import { retryBackoff } from "@amrc-factoryplus/rx-util";
import { DataAccess as Constants } from "./constants.js";
import { valid_uuid, DatasetValidity } from "./validate.js";
import { convertToCsv } from './utils.js';


function fail(log, status, message) {
    log(message);
    throw new APIError(status);
  }

export class APIv1 {
  constructor(opts) {
    this.data = opts.data;
    this.auth = opts.auth;
    this.cdb = opts.cdb;
    this.log = opts.debug.bound("apiv1");
    this.influxReader = opts.influxReader;
    this.routes = this.setup_routes();
  }

  setup_routes() {
    let api = express.Router();

    api.route("/metadata")
      .get(this.metadata_list.bind(this));

    api.route("/metadata/:uuid")
      .get(this.metadata_uuid.bind(this));
    
    api.route("/data/:uuid")
      .post(this.dataset_data.bind(this));

    api.route("/structure")
      .get(this.structure_list.bind(this))
      .post(this.structure_create.bind(this));

    api.route("/structure/:uuid")
      .get(this.structure_uuid.bind(this))
      .put(this.structure_update.bind(this));

    return api;
  }

  /** GET. Returns a list of Dataset UUIDs that the client has READ_DATASET access to.
   * The dataset can be optionally restricted by from and to dates (this is not implemented yet).
   * Dates must be in the format ISO date-time string in UTC 2025-11-13T09:33:18.000Z
   * @param from {date} (optional, inclusive) query param
   * @param to {date} (optional, inclusive) query param
   * Don't return invalid datasets
  */
  async metadata_list(req, res) {
    const uuids = await this.data.get_allowed_dataset_uuids(req.auth, Constants.Perm.ReadDataset, DatasetValidity.VALID);
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

    const datasets = await rx.firstValueFrom(this.data.get_dataset_definitions(DatasetValidity.VALID));
    const dataset = await datasets.get(dataset_uuid);
    if(!dataset) return fail(this.log, 404, `Dataset ${dataset_uuid} is not found or invalid.`);
    
    const from = dataset.config?.from;
    const to = dataset.config?.to;

    const infos = await rx.firstValueFrom(this.data.general_infos);
    const info = infos.get(dataset_uuid);
    
    const all_f_types = await rx.firstValueFrom(this.data.functional_types);
    const f_types = all_f_types.get(dataset_uuid);

    const all_metadata = await rx.firstValueFrom(this.data.metadata);
    const metadata = all_metadata.get(dataset_uuid); 

    const parts = await this.data.get_dataset_allowed_parts(dataset_uuid, req.auth, Constants.Perm.ReadDataset);

    const meta = {
      uuid: dataset_uuid,
      name: info ? info.name : "UNKNOWN",
      from: from ? from : undefined,
      to: to ? to : undefined,
      function: f_types,
      metadata,
      parts: parts
    }
    return res.status(200).json(meta);
  }


  // Check if principal has necessary permission to referenced source
  async _check_second_level_permission(principal, structure, config){

    if( structure == Constants.App.SparkplugSrc){

      const target = config.source;
      if(!target) return fail(this.log, 422, `Dataset definition does not contain source.`);

      if(!valid_uuid(target)) return fail(this.log, 422, `Source uuid ${target} is invalid.`);

      const ok = await this.auth.check_acl(
        principal, 
        Constants.Perm.UseSparkplug,
        target,
        true
      );
      
      return ok; 
    }

    if(structure == Constants.App.SessionLimits){

      const target = config.source;
      if(!target) return fail(this.log, 422, `Dataset definition does not contain source.`);

      if(!valid_uuid(target)) return fail(this.log, 422, `Source uuid ${target} is invalid.`);

      const ok = await this.auth.check_acl(
        principal, 
        Constants.Perm.UseForSession,
        target,
        true
      );
      
      return ok; 
      
    }else if(structure == Constants.App.UnionComponents){
      if(config.length == 0) return true;

      if(!Array.isArray(config)) return fail(this.log, 422, `Dataset def of structure ${structure} must be an Array.`);

      for(let target of config){

        const ok = await this.auth.check_acl(
          principal, 
          Constants.Perm.IncludeInUnion,
          target,
          true
        );

        if(!ok) return false;
      }

      return true;

    }else{
      // Unhandled Structure type
      return fail(this.log, 422, `Structure ${structure} is unknown`);
    }
  }

  _merge_intervals(queries) {
    return ISeq(queries)
      .groupBy(q => q.source)
      .flatMap((group, source) => {
        const intervals = group
          .map(q => ({
            from: q.from ? new Date(q.from) : new Date(0),
            to: q.to ? new Date(q.to) : new Date()
          }))
          .sortBy(i => i.from)
          .toArray(); 

        const merged = [];

        for (const interval of intervals) {
          if (!merged.length) {
            merged.push(interval);
            continue;
          }

          const last = merged[merged.length - 1];

          if (interval.from <= last.to) {
            last.to = new Date(Math.max(last.to, interval.to));
          } else {
            merged.push(interval);
          }
        }

        return merged.map(m => ({
          source,
          from: m.from,
          to: m.to
        }));
      })
      .toArray();
  }


  // Resolve nested datasets 
  async _resolve_dataset(dataset_uuid, from=null, to=null, visited = new Set()) {
      const datasets = await rx.firstValueFrom(this.data.datasets);
      const dataset = await datasets.get(dataset_uuid);

      if (!dataset) return fail(this.log, 404, `Dataset not found for ${dataset_uuid}`);

      if(dataset.validity === DatasetValidity.INVALID) return fail(this.log, 404, `Invalid dataset ${dataset_uuid}`);
      
      if(visited.has(dataset_uuid)) return fail(this.log, 404, `Circular dataset reference detected at ${dataset_uuid}`);

      visited.add(dataset_uuid);

      const { structure, config } = dataset;

      if(!structure) return fail(this.log, 404, `Structure not found for ${dataset_uuid}`);
    
      if(!valid_uuid(structure)) return fail(this.log, 404, `Invalid structure uuid for ${dataset_uuid}`);

      // -------------------------
      // 1. SparkplugSrc (BASE CASE)
      // -------------------------
      if (structure === Constants.App.SparkplugSrc) {
        const source_uuid = config?.source;
        
        if (!source_uuid) return fail(this.log, 404, `Dataset def ${dataset_uuid} does not contain source uuid.`);
        
        if(!valid_uuid(source_uuid)) return fail(this.log, 404, `Dataset ${dataset_uuid}'s source uuid is invalid.`);

        return [{
            source: source_uuid,
            from,
            to
        }];
      }



      // -------------------------
      // 2. SessionLimits (SINGLE REFERENCE)
      // -------------------------
      else if (structure === Constants.App.SessionLimits) {
        const source_uuid = config?.source;

        if (!source_uuid) return fail(this.log, 404, `Dataset def ${dataset_uuid} does not contain source uuid`);

        if(!valid_uuid(source_uuid)) return fail(this.log, 404, `Dataset ${dataset_uuid}'s source is invalid uuid`);

        const session_from = config?.from ? new Date(config.from) : null;
        const session_to = config?.to ? new Date(config.to) : null;

        const new_from = from && session_from
        ? new Date(Math.max(from, session_from))
        : (from || session_from);

        const new_to = to && session_to
        ? new Date(Math.min(to, session_to))
        : (to || session_to);

        if(new_from && new_to && new_from >= new_to){
            return []; // no overlap
        }

        return this._resolve_dataset(source_uuid, new_from, new_to, visited);
      }



      // -------------------------
      // 3. UnionComponents (MULTIPLE REFERENCES)
      // -------------------------
      else if (structure === Constants.App.UnionComponents) {
        if(!Array.isArray(config)) return fail(this.log, 404, `Union structure type dataset def must be Array ${dataset_uuid}`);
        
        const results = await Promise.all(
            config.map(uuid => 
                this._resolve_dataset(uuid, from, to, new Set(visited))
            )
        );

        return results.flat();
      }



    // -------------------------
    // 4. Unknown structure
    // -------------------------
    else {
        return fail(this.log, 404, `Dataset ${dataset_uuid} has unknown structure type ${structure}`);
    }
  }

  /** POST. Queries all possible Influx suffixes, combines the measuremenets and returns actual data from a dataset. 
   * Empty POST body requests all dataset measurements.
   * @param {*} req 
   * @param {*} res 
   * @returns CSV with columns:
              * device - Device this data point comes from
              * metric - metric name (don't include Influx :x suffix)
              * timestamp - ISO string
              * value - actual data value
              * unit - Engineering unit (if available)
    * Don't return valid response if dataset is invalid
  
  Influx tags:
    [
    "_start",
    "_stop",
    "_field",
    "_measurement",
    "bottomLevelInstance",
    "bottomLevelSchema",
    "device",
    "group",
    "node",
    "path",
    "topLevelInstance",
    "topLevelSchema",
    "usesInstances",
    "usesSchemas"
  ]
   */
  async dataset_data(req, res) {
    const dataset_uuid = req.params.uuid;
    if (!valid_uuid(dataset_uuid)) return fail(this.log, 422, `Dataset uuid ${dataset_uuid} is invalid.`);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.ReadDataset,
      dataset_uuid,
      true,
    );
    if (!ok) return fail(this.log, 403, `You don't have Read permission for dataset ${dataset_uuid}`);

    try {
      const resolved = await this._resolve_dataset(dataset_uuid);
      const merged = this._merge_intervals(resolved);

      const results = await Promise.all(
        merged.map(q => 
            this.influxReader.get_dataset_data(q.source, {
                from: q.from?.toISOString(),
                to: q.to?.toISOString()
            })
        )
      );
      const rows = results.flat();
      this.log(`# influx rows = ${rows.length}`);

      const csv = convertToCsv(rows);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${dataset_uuid}.csv`);
      return res.status(200).send(csv);

    } catch (err) {
      this.log(err);
      return fail(this.log, 500);
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
    const uuids = await this.data.get_allowed_dataset_uuids(req.auth, Constants.Perm.EditDataset, DatasetValidity.ALL);
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

    if (!ok) return fail(this.log, 403, `You don't have permission to Edit dataset ${uuid}.`);

    const dataset = await rx.firstValueFrom(
      this.data.get_dataset_definitions(DatasetValidity.ALL).pipe(
        rx.map(datasets => datasets.get(dataset_uuid))
      )
    );

    if (!dataset) return fail(this.log, 404, `Dataset not found for ${dataset_uuid}.`);
    return res.status(200).json(dataset);
  } 
  

  async _update_dataset_config(principal, structure, config, objectUuid){ 
    const ok2 = await this._check_second_level_permission(principal, structure, config);
    
    if(!ok2) return fail(this.log, 403, `You don't have permission for source(s) in config.`);

    // Create new Dataset Object
    if(!objectUuid){
      objectUuid = await this.cdb.create_object(Constants.Class.Dataset);
      this.log("Created new dataset object in ConfigDB", objectUuid);
    }

    // Create config entry for the dataset object
    await this.cdb.put_config(structure, objectUuid, config);
    this.log(`Added config for ${objectUuid}`);

    this._create_subclass_relationship(structure, objectUuid, config);

    this.log(`Created subclass relationship for ${objectUuid}`);
    return objectUuid;
  }

  async _create_subclass_relationship(structure, dataset_uuid, config) {
    if (structure === Constants.App.SessionLimits) {
      await this._add_cdb_subclass(config?.source, dataset_uuid);
    }
    else if (structure === Constants.App.UnionComponents) {
      for (let source of config) {
        await this._add_cdb_subclass(dataset_uuid, source);
      }
    }
  }

  async _add_cdb_subclass(klass, obj){
      await rx.lastValueFrom(
        rx.defer(() =>
          this.cdb.class_add_subclass(klass, obj)
        ).pipe(retryBackoff(500, e => this.log(e)))
      );
  }

  async _unlink_subclasses(dataset_uuid, structure, config){
    if (structure === Constants.App.SparkplugSrc) return;
    else if(structure === Constants.App.SessionLimits){
        // remove the dataset from subclasses of its source dataset
        await this.cdb.class_remove_subclass(config.source, dataset_uuid);
        this.log(`Removed ${dataset_uuid} from ${config.source} subclasses.`)
      
    }else if(structure === Constants.App.UnionComponents){
      if(config.length <= 0) return;

      for (const source_uuid of config){
        await this.cdb.class_remove_subclass(dataset_uuid, source_uuid);
        this.log(`Removed ${dataset_uuid} from ${source_uuid} subclasses.`);
      }
    }else{
      return fail(this.log, 404, `Unknown structure type ${structure}`);
    }
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

    if(!config) return fail(this.log, 422, `Config not provided in request body.`)

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.CreateDataset,
      structure,
      true
    );

    if (!ok) return fail(this.log, 403, `You don't have Create permission for structure ${structure}`);

    const objectUuid = await this._update_dataset_config(
      req.auth,
      structure,
      config,
      null
    );

    return res.status(200).json(objectUuid);
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
    if(!valid_uuid(dataset_uuid)) return fail(this.log, 422, `Invalid uuid ${dataset_uuid}`);

    const structure = req.body.structure;
    if(!structure) return fail(this.log, 422, `Structure not provided`);

    const new_config = req.body.config;
    if(!new_config) return fail(this.log, 422, `Config not provided`);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.EditDataset,
      dataset_uuid,
      true
    );

    if (!ok) return fail(this.log, 403, `You don't have Edit permission for dataset ${dataset_uuid}`);

    const datasets = await rx.firstValueFrom(this.data.get_dataset_definitions(DatasetValidity.ALL));
    const dataset = datasets.get(dataset_uuid);
    if(!dataset) return fail(this.log, 404, `Dataset ${dataset_uuid} not found.`);

    const current_structure = dataset.structure;
    const current_config = dataset.config; 
    const is_valid = (dataset.validity == DatasetValidity.VALID);

    // for VALID dataset
    if(is_valid){
      if(current_structure != structure) return fail(this.log, 409, `Changing structure type is not allowed (current: ${current_structure}, new: ${structure})`); 

      // remove all subclass relationships with current config sources
      await this._unlink_subclasses(
        dataset_uuid,
        current_structure, 
        current_config
      );
    }
    // For INVALID dataset
    else{
      // delete configs for all other structures
      const all_structure_apps = Object.values(Constants.App);

      for(const s of all_structure_apps){
        try{
          await this.cdb.delete_config(s, dataset_uuid);
        }catch(e){
          ServiceError.check(404);
        }
      }
    } 

    const objectUuid = await this._update_dataset_config(
      req.auth,
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
