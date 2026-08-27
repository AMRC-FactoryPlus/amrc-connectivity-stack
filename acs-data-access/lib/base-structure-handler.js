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

  /** Does this config point at the given dataset?
   *
   * Used by the delete path to find datasets that would be left with a
   * dangling reference. Structures that only point at non-dataset objects
   * return false.
   *
   * @param config The stored config document of another dataset.
   * @param target_uuid The dataset UUID we are about to delete.
   * @returns {boolean}
   */
  references(config, target_uuid) { return false; }
}