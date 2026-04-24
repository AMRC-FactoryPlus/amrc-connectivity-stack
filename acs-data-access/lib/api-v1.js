/*
* ACS Data Access Service
* APIv1
*/

import express from "express";
import { Map as IMap } from "immutable";
import * as rx from "rxjs";

import { APIError } from "@amrc-factoryplus/service-api";
import { DataAccess as Constants } from "./constants.js";
import { valid_uuid, DatasetValidity } from "./validate.js";
import {convert_to_csv, minDate, maxDate} from './utils.js';

function fail(status, message) {
  throw new APIError(status);
}

const mapStructureToPermission = IMap()
  .set(Constants.App.UnionComponents, Constants.Perm.IncludeInUnion)
  .set(Constants.App.SessionLimits, Constants.Perm.UseForSession)
  .set(Constants.App.SparkplugSrc, Constants.Perm.UseSparkplug);

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
      .put(this.structure_update.bind(this))

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


  async _get_dataset_time_bounds(dataset_uuid, visited=new Set()){
    if(visited.has(dataset_uuid)) return fail(422, `Cycle detected at dataset ${dataset_uuid}`);

    visited.add(dataset_uuid);

    const def = await this.data.get_dataset_def_by_uuid(dataset_uuid);
    if(!def) return fail(404, `Dataset def for ${dataset_uuid} not found`);

    const {structure, config} = def;

    // ------------------------
    // 1. SESSION 
    // ------------------------
    if(structure === Constants.App.SessionLimits){
      const child = await this._get_dataset_time_bounds(config.source, visited);

      const from = config.from ? new Date(config.from) : null;
      const to = config.to ? new Date(config.to) : null;

      return {
        from: maxDate(from, child.from),
        to: minDate(to, child.to)
      };
    }


    // ------------------------
    // 2. SPARKPLUG SRC
    // ------------------------
    if(structure === Constants.App.SparkplugSrc){
      const {from, to} = await this._get_influx_bounds(config.source);

      return {from, to}
    }


    // ------------------------
    // 3. UNION
    // ------------------------
    if(structure === Constants.App.UnionComponents){
      const results = await Promise.all(
        config.map(source_uuid => 
          this._get_dataset_time_bounds(source_uuid, new Set(visited))
        )
      );

      const valid = results.filter(r => r.from && r.to);

      if(!valid.length) return {from: null, to: null};

      return {
        from: new Date(Math.min(...valid.map(v => v.from))),
        to: new Date(Math.max(...valid.map(v => v.to)))
      };
    }

    return {from: null, to: null};
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
    * Don't return valid response if dataset is invalid
   */
  async metadata_uuid(req, res){    
    const dataset_uuid  = req.params.uuid;
    if (!valid_uuid(dataset_uuid)) fail(410, `${dataset_uuid} is invalid uuid.`);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.ReadDataset,
      dataset_uuid,
      true,
    );
    
    if (!ok) return fail(403, `You don't have Read permission for ${dataset_uuid}`);

    const datasets = await this.data.get_allowed_dataset_uuids(req.auth, Constants.Perm.ReadDataset, DatasetValidity.VALID);
    const is_valid = await datasets.includes(dataset_uuid)
    if(!is_valid) return fail(404, `Dataset ${dataset_uuid} is not found: it's either invalid or does not exist.`);

    const infos = await rx.firstValueFrom(this.data.get_general_infos());
    const info = infos.get(dataset_uuid);
    if(!info) return fail(404, `General info does not exist for dataset ${dataset_uuid}`);

    const f_types = await rx.firstValueFrom(this.data.get_functional_types());
    const f_type = f_types.get(dataset_uuid);

    const all_metadata = await rx.firstValueFrom(this.data.get_metadata());
    const metadata = all_metadata.get(dataset_uuid); 

    /**
     * if the queried dataset does not have from to time period -> recursively find the earliest and latest timestamps from source datasets.
     */
    const {from, to} = await this._get_dataset_time_bounds(dataset_uuid);

    const meta = {
      uuid: dataset_uuid,
      name: info.name,
      from: from,
      to: to,
      function: f_type,
      metadata: metadata,
      parts: []
    }
    return res.status(200).json(meta);
  }


  async _check_second_level_permission(principal, structure, config, permission){
    if(structure == Constants.App.SessionLimits || structure == Constants.App.SparkplugSrc){
      this.log(`second level ACL check for structure ${structure} and config ${config}`);
      const target = config.source;
      if(!target) return fail(422, `Dataset definition does not contain source.`);
      if(!valid_uuid(target)) return fail(422, `Source uuid ${target} is invalid.`);

      const ok = await this.auth.check_acl(
        principal, 
        permission,
        target,
        true
      );
      
      return ok; 
      
    }else if(structure == Constants.App.UnionComponents){
      if(config.length == 0) return true;
      if(!Array.isArray(config)) return fail(422, `Dataset def of structure ${structure} must be Array.`);

      for(let target of config){
        const ok = await this.auth.check_acl(
          principal, 
          permission,
          target,
          true
        );
        if(!ok) return false;
      }
      return true;

    }else{
      // Unhandled Structure type
      return fail(422, `Structure ${structure} is unknown`);
    }
  }


  

  _merge_intervals(queries){
    const grouped = {};

    for (const q of queries){
        if(!grouped[q.source]) grouped[q.source] = [];
        grouped[q.source].push(q);
    }

    const result = []; 

    for(const source in grouped){
        const intervals = grouped[source]
            .map(q => ({
                from: q.from ? new Date(q.from) : new Date(0),
                to: q.to ? new Date(q.to) : new Date()
            }))
            .sort((a, b) => a.from - b.from);
    

        let merged = [];
        
        for(const interval of intervals){
            if(!merged.length){
                merged.push(interval);
                continue;
            }
            const last = merged[merged.length - 1];

            if(interval.from <= last.to){
                last.to = new Date(Math.max(last.to, interval.to));
            }else{
                merged.push(interval);
            }
        }

        for (const m of merged){
            result.push({
                source,
                from: m.from,
                to: m.to
            });
        }
    }
    return result;
  }


  async _resolve_dataset(dataset_uuid, from=null, to=null, visited = new Set()) {
    if (visited.has(dataset_uuid)) {
        return fail(404, `Circular dataset reference detected at ${dataset_uuid}`);
      }

      visited.add(dataset_uuid);

      const dataset_def = await this.data.get_dataset_def_by_uuid(dataset_uuid);
      if (!dataset_def) return fail(404, `Dataset definition not found for ${dataset_uuid}`);

      const { structure, config } = dataset_def;
      if(!structure) return fail(422, `Structure is not found in dataset definition ${dataset_uuid}`);
      if(!valid_uuid(structure)) return fail(422, `Structure uuid is invalid for dataset ${dataset_uuid}`);

      // -------------------------
      // 1. SparkplugSrc (BASE CASE)
      // -------------------------
      if (structure === Constants.App.SparkplugSrc) {
        const source_uuid = config?.source;
        
        if (!source_uuid) return fail(422, `Dataset def ${dataset_uuid} does not contain source uuid.`);
        
        if(!valid_uuid(source_uuid)) return fail(422, `Dataset ${dataset_uuid}'s source uuid is invalid.`);

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
        if (!source_uuid) return fail(422, `Dataset def ${dataset_uuid} does not contain source uuid`);

        if(!valid_uuid(source_uuid)) return fail(422, `Dataset ${dataset_uuid}'s source is invalid uuid`);

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
        if(!Array.isArray(config)) return fail(422, `Union structure type dataset def must be Array ${dataset_uuid}`);
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
        return fail(422, `Dataset ${dataset_uuid} has unknown structure type ${structure}`);
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
    if (!valid_uuid(dataset_uuid)) return fail(422, `Dataset uuid ${dataset_uuid} is invalid.`);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.ReadDataset,
      dataset_uuid,
      true,
    );
    if (!ok) return fail(403, `You don't have Read permission for dataset ${dataset_uuid}`);

    const dataset_def = await this.data.get_dataset_def_by_uuid(dataset_uuid);
    if (!dataset_def) return fail(404, `Dataset def ${dataset_uuid} not found or invalid.`);

    const ok2 = await this._check_second_level_permission(
      req.auth,
      dataset_def?.structure,
      dataset_def?.config,
      Constants.Perm.ReadDataset
    );
    if (!ok2) return fail(403, `You don't have permissions to Read the contents of dataset ${dataset_uuid}.`);

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

      const csv = convert_to_csv(rows);

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${dataset_uuid}.csv`);
      return res.status(200).send(csv);

    } catch (err) {
      this.log(err);
      return fail(500);
    }
  }


  /** GET. 
   * 
   * @param {*} req 
   * @param {*} res 
   * @returns list of dataset UUIDs the client has permission to EDIT
   * the response should include invalid datasets 
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
  * the response should specify structure field as invalid uuid in definition if the dataset is invalid
   */
  async structure_uuid(req, res) {
    const { uuid } = req.params;
    
    if (!valid_uuid(uuid)) return fail(422, `Dataset uuid ${uuid} is invalid.`);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.EditDataset,
      uuid,
      true,
    );

    if (!ok) return fail(403, `You don't have permission to Edit dataset ${uuid}.`);

    const definition = await rx.firstValueFrom(
      this.data.get_dataset_definitions(DatasetValidity.ALL).pipe(
        rx.map(datasets => datasets.get(uuid))
      )
    );

    if (!definition) return fail(404, `Dataset def with uuid ${uuid} not found.`);

    if (definition.length > 1){
      for(let def of definition){
        def.structure = Constants.Special.InvalidDataset;
      }
    }

    return res.status(200).json(definition);
  } 
  

  async _update_dataset_config(principal, structure, config, objectUuid){
    if(!structure) return fail(422, `Structure not provided.`);
    if(!valid_uuid(structure)) return fail(422, `Structure uuid ${structure} is invalid.`)
    
    const ok = await this.auth.check_acl(
      principal,
      Constants.Perm.CreateDataset,
      structure,
      true
    );

    if (!ok) return fail(403, `You don't have Create permission for structure ${structure}`);

    this.log(`Passed ACL Check to CreateDataset for structure ${structure}`);

    if(!config) return fail(422, `Config not provided.`);
    
    // Check the principal has appropriate permission for all dataset sources in config. 
    this.log(`Now will try ACL check ${mapStructureToPermission.get(structure)} for ${config.source} `);
    const ok2 = await this._check_second_level_permission(principal, structure, config, mapStructureToPermission.get(structure));
    
    if(!ok2) return fail(403, `You don't have ${mapStructureToPermission.get(structure)} permission for dataset source(s).`);


    // Create new Dataset Object
    if(!objectUuid){
      objectUuid = await this.cdb.create_object(Constants.Class.Dataset);
      
      if(!objectUuid) return fail(400, `New Dataset object couldn't be created in ConfigDB.`);

      this.log("Created new dataset object in ConfigDB", objectUuid);
    }

    // Create config entry for the dataset object
    try{
      await this.cdb.put_config(structure, objectUuid, config);
      this.log("Updated dataset def in ConfigDB", objectUuid);
    }catch(err){
      return fail(422, `Config entry for ${objectUuid} couldn't be updated.`);
    }

    return objectUuid;
  }

  
  /** POST. Creates a new dataset. 
   * 
   * @param {*} req.body must be object (structure, config) without uuid.
   * @param {*} res 
   * @returns new dataset's UUID - JSON string 
   */
  async structure_create(req, res){
    const objectUuid = await this._update_dataset_config(
      req.auth,
      req.body.structure,
      req.body.config,
      null
    );

    if(!objectUuid) return fail(422, `Failed to create new Dataset.`);
    return res.status(200).json(objectUuid);
  }


  
  /** PUT. Updates dataset definition. Principal should have CreateDataset permission
   * 
   * @param {*} req.body must be object (structure, config) and UUID (optional)
   * @param {*} res 
   */

  async structure_update(req, res){
    const dataset_uuid = req.params.uuid;
    if(!valid_uuid(dataset_uuid)) return fail(422, `Dataset uuid is invalid.`);

    const objectUuid = await this._update_dataset_config(
      req.auth,
      req.body.structure,
      req.body.config,
      dataset_uuid
    );

    if(!objectUuid) return fail(422, `Failed to update dataset ${dataset_uuid}`);

    // remove definitions from other structure apps
    const invalid_defs = await rx.firstValueFrom(
      this.data.get_dataset_definitions(DatasetValidity.INVALID).pipe(
        rx.map(datasets => datasets.get(dataset_uuid) ?? []),
        rx.map(defs => defs.filter(d => d.structure !== req.body.structure)),
        rx.map(filtered => filtered.length ? filtered : undefined)
      )
    );

    if (invalid_defs?.length) {
      this.log(`Deleting invalid defs from ConfigDB`);

      for (const i_def of invalid_defs) {
        this.cdb.delete_config(i_def.structure, objectUuid);
      }
    }

    return res.status(200).json(objectUuid);
  }
}
