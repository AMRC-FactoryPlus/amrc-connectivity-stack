/*
 * ACS Admin
 * Which schema actions the logged-in user's ACL allows
 * Copyright 2026 University of Sheffield
 */

import { UUIDs } from '@amrc-factoryplus/service-client'

import { SCHEMA_DRAFT_APP, SCHEMA_DRAFT_CLASS } from './registry.js'

/** Schema actions allowed by an access checker (useAccessStore().check).
 * These only hide controls that would certainly be refused. */
export function schema_access (check) {
  return {
    /* A new draft: create the object, then write its name and body. */
    new_draft: check.create_in(SCHEMA_DRAFT_CLASS)
      && check.write_apps(UUIDs.App.Info, SCHEMA_DRAFT_APP),
    /* Saving a draft that already exists. */
    save_draft: check.write_apps(UUIDs.App.Info, SCHEMA_DRAFT_APP),
    /* Publishing writes the schema, its information and its name.
     * Publishing as a new schema also creates it, which the publish
     * page checks itself. */
    publish: check.write_apps(UUIDs.App.Schema, UUIDs.App.SchemaInformation, UUIDs.App.Info),
    publish_new: check.create_in(UUIDs.Class.Schema),
    delete_draft: uuid => check.delete_obj(uuid),
  }
}
