import * as rx from "rxjs";

import { retryBackoff } from "@amrc-factoryplus/rx-util";

import {BaseStructureHandler} from './base-structure-handler.js';
import { fail } from './utils.js';
import { valid_uuid, valid_datetime } from "./validate.js";
import { DataAccess as Constants } from "./constants.js";



export class SessionLimitsHandler extends BaseStructureHandler {
  constructor(api){
    super(api);

    this.structure = Constants.App.SessionLimits;
    this.sourcePermission = Constants.Perm.UseForSession;
  }

  validate_config(config) {
    if(!config)
      return fail(this.log, 422, `config not provided`);

    const {to, from, source} = config;
    if(!to || !from || !source)
      return fail(this.log, 422, `req.body.config for SessionLimits type must contain "source", "to" and "from" fields.`);

    if(!valid_uuid(source)) 
      return fail(this.log, 422, `req.body.config.source uuid is invalid.`);

    if(!valid_datetime(to))
      return fail(this.log, 422, `req.body.config.to datetime format is invalid.`);

    if(!valid_datetime(from))
      return fail(this.log, 422, `req.body.config.from datetime format is invalid.`);
  }

  async check_sources_permissions(principal, config) {
    const target = config.source;
    if(!target) return fail(this.log, 422, `Dataset definition does not contain source.`);

    if(!valid_uuid(target)) return fail(this.log, 422, `Source uuid ${target} is invalid.`);

    const ok = await this.auth.check_acl(
      principal, 
      this.sourcePermission,
      target,
      true
    );
    
    return ok; 
  }

  async resolve({ config, inherited_range, visited }) {
    const session_range = {
      from: config.from ?? null,
      to: config.to ?? null,
    };

    const merged_range = this.api.intersectRanges(
      inherited_range,
      session_range,
    );

    return this.api.resolve_dataset(
      config.source,
      merged_range,
      visited,
    );
  }

  async create_subclass_relationships(dataset_uuid, config) {
    await rx.lastValueFrom(
      rx.defer(() =>
        this.cdb.class_add_subclass(config.source, dataset_uuid)
      ).pipe(retryBackoff(500, e => this.log(e)))
    );
  }

  async remove_subclass_relationships(dataset_uuid, config) {
    await this.cdb.class_remove_subclass(config.source, dataset_uuid);
    this.log(`Removed ${dataset_uuid} from ${config.source} subclasses.`)
  }
}