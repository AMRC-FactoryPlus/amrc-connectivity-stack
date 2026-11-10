export class BaseStructureHandler {
  constructor(api) {
    this.api = api;
    this.auth = api.auth;
    this.log = api.log;
    this.cdb = api.cdb;

    /* The logical bucket a resolved source reads (Constants.Store),
     * for structures that resolve to devices. */
    this.store = null;
    /* For a structure that can no longer be created, the structures to
     * use instead. Existing datasets of it still work: they can be
     * read, edited, used in unions and sessions, and deleted. */
    this.replaced_by = null;
  }

  validate_config(config) {}
  check_source_permission(principal, config) {}

  /** Checks a new or changed source beyond the caller's permission.
   *
   * Called on create and update after the source permission check, so
   * a caller without permission learns nothing about the source.
   * Throws a Refusal or an APIError if the source is not acceptable.
   *
   * @param config A config that has passed validate_config.
   */
  async check_source(config) {}

  /** Converts a validated config to the form that is stored.
   *
   * Called on create and update, after the source permission check and
   * before the config is written to ConfigDB. Structures that accept only
   * one form return the config unchanged.
   *
   * @param config A config that has passed validate_config.
   * @returns The config to store.
   */
  async normalise_config(config) { return config; }
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