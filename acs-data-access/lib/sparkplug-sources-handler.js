import {BaseStructureHandler} from './base-structure-handler.js';
import { fail } from './utils.js';
import { valid_uuid } from "./validate.js";
import { DataAccess as Constants } from "./constants.js";

export class SparkplugSourcesHandler extends BaseStructureHandler {
  constructor(api){
    super(api);

    this.structure = Constants.App.SparkplugSrc;
    this.sourcePermission = Constants.Perm.UseSparkplug;
  }

  validate_config(config) {
    if(!config)
      return fail(this.log, 422, `config not provided`);

    const source = config.source;
    if(!source)
      return fail(this.log, 422, `config for SparkplugSrc structure type ${this.structure} must contain "source" field.`);

    if(!valid_uuid(source))
      return fail(this.log, 422, `config.source uuid is invalid.`);
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

  async resolve({ dataset_uuid, config, inherited_range }) {
    return [{
        dataset_uuid, 
        device_uuid: config.source,
        from: inherited_range.from,
        to: inherited_range.to,
      }];
  }

  async create_subclass_relationships() {
    return;
  }

  async remove_subclass_relationships() {
    return;
  }
}