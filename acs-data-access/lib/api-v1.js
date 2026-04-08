/*
* ACS Data Access Service
* APIV1
*/

import express from "express";
import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import {InfluxDB, flux} from '@influxdata/influxdb-client';

import { APIError } from "@amrc-factoryplus/service-api";
import { DataAccess as Constants } from "./constants.js";
import { valid_grant, valid_krb, valid_uuid, DatasetValidity } from "./validate.js";



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
    this.influx_bucket = opts.influx_bucket;
    this.influx_org = opts.influx_org;
    this.influx_query_api = opts.influx_client.getQueryApi(opts.influx_org);
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

  async _get_allowed_dataset_uuids(principal, permission, dataset_validity) {
    const dataset_def_obs = this.data.get_dataset_definitions(dataset_validity);
    
    const result = await rx.firstValueFrom(
      rx.combineLatest([
        dataset_def_obs,
        this.auth.watch_acl_with_perm(principal, permission)
      ]).pipe(
        rx.map(([datasets, targets]) => {
          // datasets: IMap<datasetId, {...}>
          // targets: Set or ISet of allowed datasetIds

          return datasets
            .keySeq()                // get all dataset IDs
            .filter(id => targets.has(id))
            .toArray();              // convert to plain array
        })
      )
    );

    return result;
  }



  /** GET. Returns a list of Dataset UUIDs that the client has READ access to.
   * The dataset can be optionally restricted by from and to dates. 
   * Dates must be in the format ISO date-time string in UTC 2025-11-13T09:33:18.000Z
   * @param from {date} (optional, inclusive) query param
   * @param to {date} (optional, inclusive) query param
   * Don't return invalid datasets
  */
  async metadata_list(req, res) {
    const uuids = await this._get_allowed_dataset_uuids(req.auth, Constants.Perm.ReadDataset, DatasetValidity.VALID);
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
    * Don't return valid response if dataset is invalid
   */
  async metadata_uuid(req, res){
    // to be implemented
    const {uuid} = req.params
    if (!valid_uuid(uuid)) fail(410);
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
   */
  async dataset_data(req, res){
    // to be implemented
    const dataset_uuid = req.params.uuid;
    // if (!valid_uuid(dataset_uuid)) return fail(410);

    // const dataset_def = await rx.firstValueFrom(
    //   this.data.get_dataset_definitions().pipe(
    //     rx.map(datasets => datasets.get(dataset_uuid))
    //   )
    // );

    // // Recursion until the structure is Device -> get data out of influx

    // const source_uuid = dataset_def.config.source; 

    // // get sprk uuid for that device
    // // const instance_uuid = 

    // if (!source_uuid) return fail(404);

    // const query = flux`from(bucket: "${this.influx_bucket}")
    // |> range(start: -1d)
    // |> filter(fn: (r) => r.topLevelInstance == "${source_uuid}")`;

    // const rows = [];

    // this.influx_query_api.queryRows(query, {
    //   next: (row, tableMeta) => {
    //     const o = tableMeta.toObject(row);
    //     rows.push({
    //       _time: o._time,
    //       _measurement: o._measurement,
    //       _value: o._value
    //     });
    //   },
    //   error: (err) => {
    //     return res.status(500).json(err);
    //   },
    //   complete: () => {
    //     return res.status(200).json(rows); 
    //   }
    // });
  }

  /** GET. 
   * 
   * @param {*} req 
   * @param {*} res 
   * @returns list of dataset UUIDs the client has permission to EDIT
   * the response should include invalid datasets 
   */
  async structure_list(req, res){
    const uuids = await this._get_allowed_dataset_uuids(req.auth, Constants.Perm.EditDataset, DatasetValidity.ALL);
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
    
    if (!valid_uuid(uuid)) return fail(410);

    const ok = await this.auth.check_acl(
      req.auth,
      Constants.Perm.EditDataset,
      uuid,
      true,
    );

    if (!ok) return fail(403);

    const definition = await rx.firstValueFrom(
      this.data.get_dataset_definitions(DatasetValidity.ALL).pipe(
        rx.map(datasets => datasets.get(uuid))
      )
    );

    if (!definition) return fail(404);

    if (definition.length > 1){
      for(let def of definition){
        def.structure = Constants.Special.InvalidDataset;
      }
    }

    return res.status(200).json(definition);
  } 
  

  async _check_second_level_permission(principal, structure, config){
    if(structure == Constants.App.SessionLimits){
      
      const target = config.source;
      if(!target) return fail(422);

      const ok = await this.auth.check_acl(
          principal, 
          mapStructureToPermission.get(structure),
          target,
          true
        );
      
      return ok; 
      
    }else if(structure == Constants.App.UnionComponents){
      if(config.length == 0) return true;

      for(let target of config){
        const ok = await this.auth.check_acl(
          principal, 
          mapStructureToPermission.get(structure),
          target,
          true
        );
        if(!ok) return false;
      }
      return true;

    }else if( structure == Constants.App.SparkplugSrc){
      
      const target = config.source;
      if(!target) return fail(422);

      const ok = await this.auth.check_acl(
          principal, 
          mapStructureToPermission.get(structure),
          target,
          true
        );

      return ok; 
    }else{
      // Unhandled Structure type
      return fail(500);
    }
  }


  async _update_dataset_config(principal, structure, config, objectUuid){
    if(!structure) return fail(422);
    
    if (!valid_uuid(structure)) return fail(410);

    const ok = await this.auth.check_acl(
      principal,
      Constants.Perm.CreateDataset,
      structure,
      true
    );

    if (!ok) return fail(403);

    if(!config) return fail(422);
    
    // Check the principal has appropriate permission for all dataset sources in config. 
    const ok2 = await this._check_second_level_permission(principal, structure, config);
    
    if(!ok2) return fail(403);


    // Create new Dataset Object
    if(!objectUuid){
      objectUuid = await this.cdb.create_object(Constants.Class.Dataset);
      
      this.log("Created new dataset object in ConfigDB", objectUuid);
      
      if(!objectUuid) return fail(400);
    }

    // Create config entry for the dataset object
    try{
      await this.cdb.put_config(structure, objectUuid, config);
    }catch(err){
      return fail(422);
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

    if(!objectUuid) return fail(500);
    return res.status(200).json(objectUuid);
  }


  
  /** PUT. Updates dataset definition. Principal should have CreateDataset permission
   * 
   * @param {*} req.body must be object (structure, config) and UUID (optional)
   * @param {*} res 
   */

  async structure_update(req, res){
    const objectUuid = await this._update_dataset_config(
      req.auth,
      req.body.structure,
      req.body.config,
      req.params.uuid
    );

    if(!objectUuid) return fail(500);

    // remove definitions from other structure apps
    const invalid_defs = await rx.firstValueFrom(
      this.data.get_dataset_definitions(DatasetValidity.INVALID).pipe(
        rx.map(datasets => datasets.get(req.params.uuid)),   // extract defs
        rx.filter(defs => defs && defs.length),              // ensure exists
        rx.map(defs => defs.filter(d => d.structure !== req.body.structure)) // filter array
      )
    );

    if(invalid_defs){
      for (let i_def of invalid_defs){
        this.cdb.delete_config(i_def.structure, objectUuid);
      }
    }

    return res.status(200).json(objectUuid);
  }


  async name_get(req, res) {
    const { uuid } = req.params;

    // This URL could not possibly exist (different from "could exist in the future")
    if (!valid_uuid(uuid)) fail(410);

    const names = await rx.firstValueFrom(this.data.names);
    const name = names.get(uuid);
    if (!name) fail(404);

    const ok = await this.auth.check_acl(
      // Principal
      req.auth,
      // Your own service permission
      Perm.MyGetNamePermission,
      // Target UUID
      uuid,
      // Do we accept wildcards?
      true,
    );

    if (!ok) {
      fail(403);
    }

    return res.status(200).json(name);
  }

  async name_put(req, res) {
    const { uuid } = req.params;
    if (!valid_uuid(uuid)) fail(410);

    // May need this in your own service. We don't in this case. This is checking validity of what you give the service.
    // if (grant && !valid_grant(grant)) fail(422);

    const ok = await this.auth.check_acl(
      req.auth,
      Perm.MyPutNamePermission,
      uuid,
      true,
    );

    if (!ok) {
      fail(403);
    }

    const retval = await this.data.request({ type: "name", object: uuid, name: req.body });
    return res.status(retval.status).end();
  }
}
