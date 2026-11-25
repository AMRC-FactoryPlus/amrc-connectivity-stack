/*
 * ACS Admin
 * Which pages the logged-in user can read, for the navigation and for
 * the "no access" state a page shows instead of loading for ever
 * Copyright 2026 University of Sheffield
 *
 * Each rule asks for the reads the page's main list is built from,
 * with the target the service checks. A page whose reads are refused
 * never finishes loading: a ConfigDB SEARCH or class WATCH that gets a
 * 403 emits nothing, so the stores built on them wait for ever.
 *
 * Every principal is granted ReadConfig on Info, Registration, the
 * ISA-95 vocabulary and placements, and the engineering units
 * (acs-service-setup/dumps/everyone.yaml), so that names and
 * dropdowns work everywhere. Those alone make only Units appear,
 * because the units are all that page lists.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'

import { Status } from './acl.js'
import { Auth, ConfigDB, DataAccess, Directory, GatewayDepot, MQTT } from './perms.js'
import { READ_OBJECT } from './i3x-access.js'
import { EdgeSim } from '../edge-sim-uuids.js'

const { App, Class } = UUIDs

/* What every ConfigDB list reads: the object store names each object
 * from Info and Registration. */
const NAMES = [App.Info, App.Registration]

const read_apps = (c, apps) => apps.every(a => c.can(ConfigDB.ReadApp, a))

/** Can the user read a ConfigDB class list as useStore() reads it:
 * the class's members, the names, and each app the store binds? */
export const reads_class = (c, klass, apps = []) =>
  c.can(ConfigDB.ReadMembers, klass) && read_apps(c, [...NAMES, ...apps])

const ISA95_LEVELS = [
  Class.ISA95Enterprise, Class.ISA95Site, Class.ISA95Area,
  Class.ISA95WorkCenter, Class.ISA95WorkUnit,
]

/* The reads behind each store, shared by the rules below and the
 * device page. */
export const can_read_clusters = c => reads_class(c, Class.EdgeCluster, [
  App.EdgeClusterConfiguration, App.HelmChartTemplate,
  App.EdgeClusterStatus, App.EdgeClusterSetupStatus,
])
export const can_read_nodes = c => reads_class(c, Class.EdgeAgent, [
  App.EdgeAgentDeployment, App.SparkplugAddress,
])
export const can_read_devices = c => reads_class(c, Class.Device, [
  App.DeviceInformation, App.SparkplugAddress, App.ISA95Placement,
])
export const can_read_schemas = c => reads_class(c, Class.Schema, [
  App.SchemaInformation, App.Schema,
])
export const can_read_connections = c => reads_class(c, Class.EdgeAgentConnection, [
  App.ConnectionConfiguration, App.DriverDefinition, App.EdgeClusterConfiguration,
])
export const can_read_isa95 = c =>
  ISA95_LEVELS.every(k => c.can(ConfigDB.ReadMembers, k))
  && read_apps(c, [App.ISA95Vocabulary, App.Info])

const DATASET_PERMS = [
  DataAccess.ReadDataset, DataAccess.CreateDataset, DataAccess.UseDevice,
  DataAccess.UseForSession, DataAccess.IncludeInUnion,
]

/** The sections of the admin UI, in navigation order.
 * - key: the route's meta.section.
 * - nav: false for pages reached from elsewhere, not the menu.
 * - noun: what "You don't have access to ..." names.
 * - can: (checker) => whether the user can read the page.
 */
export const Sections = [
  {
    key: 'home', title: 'Home', href: '/', icon: 'home', noun: 'Home',
    can: () => true,
  }, {
    /* i3X filters what it returns by ReadObject on each device, or on
     * an ISA-95 node above it. */
    key: 'explorer', title: 'Explorer', href: '/explorer', icon: 'compass',
    noun: 'the Explorer',
    can: c => c.can_any(READ_OBJECT),
  }, {
    /* Subscribes to the whole Sparkplug namespace. */
    key: 'activity', title: 'Live Activity', href: '/activity', icon: 'table-cells',
    noun: 'live device activity',
    can: c => c.can_any(MQTT.ReadWholeNamespace),
  }, {
    /* The Directory returns the alerts of the types or devices the
     * user may read. */
    key: 'alerts', title: 'Alerts', href: '/alerts', icon: 'bell',
    noun: 'alerts',
    can: c => c.can_any(Directory.ReadAlertType) || c.can_any(Directory.ReadDeviceAlerts),
  }, {
    key: 'cassettes', title: 'Cassettes', href: '/cassette-decks', icon: 'cassette-tape',
    noun: 'cassettes',
    can: c => reads_class(c, EdgeSim.CassetteClass, [EdgeSim.CassetteApp]),
  }, {
    /* Auth lists the principals whose identities the user may read,
     * and the grants they may read. */
    key: 'access', title: 'Access Control', href: '/access-control', icon: 'user-shield',
    noun: 'Access Control',
    can: c => c.can_any(Auth.ReadKrb) || c.can_any(Auth.ReadACL),
  }, {
    /* Opens on the list of Applications. */
    key: 'configdb', title: 'ConfigDB', href: '/configdb', icon: 'gears',
    noun: 'the ConfigDB',
    can: c => c.can(ConfigDB.ReadMembers, Class.App) && read_apps(c, NAMES),
  }, {
    key: 'files', title: 'Files', href: '/files', icon: 'file',
    noun: 'Files',
    can: c => reads_class(c, Class.File, [App.FilesConfig]),
  }, {
    key: 'bridges', title: 'Bridges', href: '/bridges', icon: 'arrow-down-up-across-line',
    noun: 'bridges',
    can: c => reads_class(c, Class.Bridge, [App.EdgeAgentDeployment, App.HelmChartTemplate]),
  }, {
    /* The Gateway Depot accepts only a wildcard grant. */
    key: 'gateway_depot', title: 'Gateway Depot', href: '/gateway-depot', icon: 'warehouse',
    noun: 'the Gateway Depot',
    can: c => c.can_wild(GatewayDepot.Provision),
  }, {
    key: 'isa95', title: 'ISA-95', href: '/isa95', icon: 'sitemap',
    noun: 'the ISA-95 hierarchy',
    can: can_read_isa95,
  }, {
    key: 'units', title: 'Units', href: '/units', icon: 'ruler',
    noun: 'units',
    can: c => read_apps(c, [App.EngineeringUnit, App.Info]),
  }, {
    key: 'schemas', title: 'Schemas', href: '/schemas', icon: 'shapes',
    noun: 'schemas',
    can: can_read_schemas,
  }, {
    /* Data Access lists the datasets the user may read. Anyone who
     * may build from a device, or use a dataset, can make one. */
    key: 'datasets', title: 'Datasets', href: '/datasets', icon: 'database',
    noun: 'datasets',
    can: c => DATASET_PERMS.some(p => c.can_any(p)),
  }, {
    key: 'edge_cluster', nav: false, noun: 'this edge cluster',
    can: can_read_clusters,
  }, {
    /* Reached from the cluster tree, so it needs the clusters too. */
    key: 'edge_node', nav: false, noun: 'this node',
    can: c => can_read_clusters(c) && can_read_nodes(c),
  },
]

const by_key = new Map(Sections.map(s => [s.key, s]))

/** The section with this key, or undefined. */
export const section = key => by_key.get(key)

/** May the user read the section with this key? An unknown key, or
 * none, is open: only the pages listed here are gated. */
export function can_see (c, key) {
  const s = by_key.get(key)
  return !s || s.can(c)
}

/** The navigation items the user can use. Empty while the ACL loads,
 * apart from Home, so items appear rather than flash up and vanish. */
export function nav_sections (c) {
  const nav = Sections.filter(s => s.nav !== false)
  if (c.status === Status.Loading) return nav.filter(s => s.key === 'home')
  return nav.filter(s => s.can(c))
}

/** What a gated page shows:
 * - 'loading' while the ACL loads,
 * - 'denied' when the user can't read it,
 * - 'open' otherwise, and for pages not gated.
 */
export function page_state (c, key) {
  if (!key || !by_key.has(key)) return 'open'
  if (c.status === Status.Loading) return 'loading'
  return can_see(c, key) ? 'open' : 'denied'
}
