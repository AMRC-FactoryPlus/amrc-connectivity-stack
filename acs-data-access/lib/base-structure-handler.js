export class BaseStructureHandler {
  constructor(api) {
    this.api = api;
    this.auth = api.auth;
    this.log = api.log;
    this.cdb = api.cdb;
  }

  validate_config(config) {}
  check_source_permission(principal, config) {}
  resolve(ctx) {}
  create_subclass_relationships(datasetUuid, config) {}
  remove_subclass_relationships(datasetUuid, config) {}
}