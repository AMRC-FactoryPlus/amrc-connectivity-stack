import * as rx from "rxjs";

import { retryBackoff } from "@amrc-factoryplus/rx-util";

import {BaseStructureHandler} from './base-structure-handler.js';
import { fail } from './utils.js';
import { valid_uuid } from "./validate.js";
import { DataAccess as Constants } from "./constants.js";

export class UnionComponentsHandler extends BaseStructureHandler {

  constructor(api){
    super(api);

    this.structure = Constants.App.UnionComponents;
    this.sourcePermission = Constants.Perm.IncludeInUnion;
  }

  validate_config(config) {
    if(!config)
      return fail(this.log, 422, `config not provided`);

    if(!Array.isArray(config))
      return fail(this.log, 422, `config must be array [] for UnionComponents structure`);

    for(let src of config){
      if (!valid_uuid(src))
        return fail(this.log, 422, `${src} is invalid UUID`);
    }
  }

  async check_sources_permissions(principal, config) {
    if(!Array.isArray(config)) return fail(this.log, 422, `Dataset def of structure ${this.structure} must be an Array.`);
    
    if(config.length == 0) return true;

    for(let target of config){
      const ok = await this.auth.check_acl(
        principal, 
        this.sourcePermission,
        target,
        true
      );

      if(!ok) return false;
    }

    return true;
  }

  async resolve({ config, inherited_range, visited }) {
    const results = [];

    for (const src of config) {
      const src_results = await this.api.resolve_dataset(
        src,
        inherited_range,
        new Set(visited),
      );

      results.push(...src_results);
    }

    return results;
  }

  async create_subclass_relationships(datasetUuid, config) {
    for (const source of config) {
      await rx.lastValueFrom(
        rx.defer(() =>
          this.cdb.class_add_subclass(datasetUuid, source)
        ).pipe(retryBackoff(500, e => this.log(e)))
      );
    }
  }

  async remove_subclass_relationships(dataset_uuid, config) {
    if(config.length <= 0) return;

    for (const src of config){
      await this.cdb.class_remove_subclass(dataset_uuid, src);
      this.log(`Removed ${dataset_uuid} from ${src} subclasses.`);
    }
  }
}