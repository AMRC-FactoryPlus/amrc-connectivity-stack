/*
 * ACS Admin
 * Read the Manager's own config (chart UUIDs) without failing for
 * users who may not read it
 * Copyright 2026 University of Sheffield
 */

import { UUIDs } from '@amrc-factoryplus/service-client'

import { ConfigDB } from './access/perms.js'
import { debug_log } from './debug-log.js'

/** The Manager's entry in Service config, or {} when the user may not
 * read it or the read fails. Nothing is logged as an error: most
 * users can't read it, and only the create dialogs need it.
 * @param client The service client.
 * @param check A checker from make_checker.
 */
export async function read_manager_config (client, check) {
  if (!check.can(ConfigDB.ReadApp, UUIDs.App.ServiceConfig)) return {}
  try {
    return await client.ConfigDB.get_config(UUIDs.App.ServiceConfig, UUIDs.Service.Manager) ?? {}
  } catch (err) {
    debug_log('Manager config not read: %o', err)
    return {}
  }
}
