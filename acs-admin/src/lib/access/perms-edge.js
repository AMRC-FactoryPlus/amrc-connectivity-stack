/*
 * ACS Admin
 * Which Edge Manager and Bridge controls a user may use
 * Copyright 2026 University of Sheffield
 *
 * Each function takes the access checker (useAccessStore().check)
 * and asks for every write the control's request makes, so a control
 * shows only when the services would accept it.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'

import { Clusters, CmdEsc } from './perms.js'

const { App, Class } = UUIDs

/* Writing the Edge Agent config after a connection or device change. */
const ea_regen = c => c.write_apps(App.EdgeAgentConfig, App.EdgeAgentDeployment)

export const can_new_cluster = c =>
  c.create_in(Class.EdgeCluster)
  && c.write_apps(App.Info, App.EdgeClusterConfiguration)

export const can_bootstrap = (c, cluster) => c.can(Clusters.Clusters, cluster)

export const can_new_node = c =>
  c.create_in(Class.EdgeAgent)
  && c.write_apps(App.Info, App.EdgeAgentDeployment)

export const can_new_deployment = c =>
  c.create_in(Class.EdgeDeployment)
  && c.write_apps(App.Info, App.EdgeAgentDeployment)

/* A node move also patches its connections, if it has any; a
 * deployment move doesn't. */
export const can_move_host = (c, kind = 'node', has_connections = true) =>
  c.patch_app(App.EdgeAgentDeployment)
  && (kind !== 'node' || !has_connections || c.patch_app(App.ConnectionConfiguration))

export const can_rebirth = (c, uuid) => c.can(CmdEsc.Rebirth, uuid)

export const can_new_device = c =>
  c.create_in(Class.Device)
  && c.write_apps(App.Info, App.ISA95Placement, App.DeviceInformation)

export const can_new_connection = c =>
  c.create_in(Class.EdgeAgentConnection)
  && c.write_apps(App.Info, App.ConnectionConfiguration)
  && ea_regen(c)

export const can_edit_connection = c =>
  c.patch_app(App.Info) && c.patch_app(App.ConnectionConfiguration) && ea_regen(c)

export const can_delete_connection = (c, conn) =>
  c.delete_obj(conn) && c.patch_app(App.DeviceInformation)

/* Schema, connection, historian switch and origin map are all merge
 * patches to the device's DeviceInformation. Those that change what
 * the Edge Agent reads also rewrite its config. */
export const can_edit_device = c => c.patch_app(App.DeviceInformation)
export const can_edit_device_ea = c => can_edit_device(c) && ea_regen(c)

export const can_place_device = c => c.write_apps(App.ISA95Placement)

export const can_save_bridge = (c, existing) =>
  (existing || c.create_in(Class.Bridge))
  && c.write_apps(App.Info, App.EdgeAgentDeployment)

export const can_delete_bridge = (c, bridge) => c.delete_obj(bridge)


