/*
* ACS Data Access Service
* APIV1
*/

import express from "express";
import * as rx from "rxjs";

import { APIError } from "@amrc-factoryplus/service-api";
import { DataAccess as Constants } from "./constants.js";
import { valid_grant, valid_krb, valid_uuid } from "./validate.js";


function fail(status, message) {
  throw new APIError(status);
}

export class APIv1 {
  constructor(opts) {
    this.data = opts.data;
    this.auth = opts.auth;
    
    this.log = opts.debug.bound("apiv1");

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


  async _get_dataset_uuid_list(principal, permission){
  const result = await rx.firstValueFrom(
          rx.combineLatest([
            this.data.get_dataset_definitions(),
            this.auth.watch_acl_with_perm(principal, permission)
          ]).pipe(
            rx.map(([datasets, targets]) => {
              const output = [];

              datasets.forEach((value) => {
                const obj = value.toJS ? value.toJS() : value;

                Object.entries(obj).forEach(([key, val]) => {
                  // key is the dataset UUID
                  if (targets.has(key)) {
                    output.push(key);
                  }
                });
              });

              return output;
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
  */
  async metadata_list(req, res) {
    const result = await this._get_dataset_uuid_list(req.auth, Constants.Perm.ReadDataset);

    return res.status(200).json(result);
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
   */
  async metadata_uuid(req, res){
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
   */
  async dataset_data(req, res){
    // 
  }

  /** GET. 
   * 
   * @param {*} req 
   * @param {*} res 
   * @returns list of dataset UUIDs the client has permission to EDIT
   */
  async structure_list(req, res){
    const result = await this._get_dataset_uuid_list(req.auth, Constants.Perm.EditDataset);

    return res.status(200).json(result);
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
   */
  async structure_uuid(req, res){
    
  }

  /** POST. Creates a new dataset. 
   * 
   * @param {*} req.body must be object (class, config) without uuid.
   * @param {*} res 
   * @returns new dataset's UUID - JSON string 
   */
  async structure_create(req, res){

  }

  /** PUT. Updates dataset definition. 
   * 
   * @param {*} req.body must be object (class, config) and UUID (optional)
   * @param {*} res 
   */
  async structure_update(req, res){

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
