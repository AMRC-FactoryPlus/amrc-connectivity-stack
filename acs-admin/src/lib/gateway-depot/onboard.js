/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The onboarding form: which clusters a gateway can join, validation
 * and the request body. Pure functions. */

import { ago, clean, cluster_name, host_of, name_of, plural } from './model.js'

/* The value of "A cluster that is not listed" in the cluster choice. */
export const MANUAL = '(another cluster)'

/* The command that prints a cluster's join token. */
export const TOKEN_COMMAND = 'sudo cat /var/lib/rancher/k3s/server/node-token'

export function new_onboard_form (gw) {
  return { mode: 'create', cluster: host_of(gw), server: null, url: '', touchedCluster: false }
}

/* Factory+ makes a cluster's Sparkplug group from its name, so two
 * names that differ only in case or punctuation clash. */
export const cluster_key = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_')

/** True when Factory+ already has a cluster with this name. */
export function cluster_name_taken (name, clusters, gw) {
  name = clean(name)
  if (!name || !Array.isArray(clusters)) return false
  /* Trying again with the name this gateway already gave is not a clash. */
  const mine = gw && gw.onboard && gw.onboard.cluster
  if (mine && clean(mine.name_given) === name) return false
  return clusters.some(c => c && cluster_key(c.name) === cluster_key(name))
}

const own_cluster = gw => (gw.onboard && gw.onboard.mode === 'create' && gw.onboard.cluster ? gw.onboard.cluster.uuid : null)

function host_count (hosts) {
  const n = Array.isArray(hosts) ? hosts.length : Number(hosts)
  return n > 0 ? n : 0
}

/* The gateway that now runs a cluster's control plane: the one the
 * service names, or the gateway that replaced it. */
function control_plane (id, by_id) {
  let gw = by_id.get(id) || null
  const seen = new Set()
  while (gw && gw.state === 'replaced' && gw.replaced_by && !seen.has(gw.id)) {
    seen.add(gw.id)
    gw = by_id.get(gw.replaced_by) || null
  }
  return gw
}

/**
 * The edge clusters a gateway could join, by name. The service says
 * which gateway built each cluster, so a person only has to think
 * about the cluster.
 *
 * @param clusters  what `GET v1/cluster` returned, or null if it has
 *  not answered. Without it the list comes from the gateways alone.
 * @param gateways  every gateway
 * @param gw        the gateway being onboarded
 * @returns [{ key, name, gateway, not_ready, hosts }] where `gateway`
 *  is the cluster's control plane gateway, or null for a cluster the
 *  depot did not build.
 */
export function join_choices (clusters, gateways, gw) {
  const by_id = new Map((gateways ?? []).map(g => [g.id, g]))
  const out = []
  if (Array.isArray(clusters)) {
    const mine = own_cluster(gw)
    for (const c of clusters) {
      if (!c || !c.uuid || c.uuid === mine) continue
      const maker = c.gateway != null ? control_plane(String(c.gateway), by_id) : null
      if (maker && maker.id === gw.id) continue
      out.push({
        key: c.uuid,
        name: clean(c.name) || c.uuid,
        gateway: maker,
        /* A control plane that has not finished onboarding cannot be joined yet. */
        not_ready: !!maker && maker.state !== 'onboarded',
        hosts: host_count(c.hosts),
      })
    }
  }
  else {
    const seen = new Set()
    for (const g of gateways ?? []) {
      if (g.id === gw.id || g.state !== 'onboarded' || !g.onboard || g.onboard.mode !== 'create') continue
      const c = g.onboard.cluster || {}
      const key = clean(c.uuid) || 'gateway ' + g.id
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, name: cluster_name(g) || 'Cluster of ' + name_of(g), gateway: g, not_ready: false, hosts: 0 })
    }
  }
  return out.sort((a, z) => a.name.localeCompare(z.name))
}

/** True when a gateway can join this cluster now. */
export const can_join = choice => !choice.gateway || (choice.gateway.online && !choice.not_ready)

/** True when joining this cluster needs its address and join token. */
export const needs_manual = (server, choice) => server === MANUAL || (!!choice && !choice.gateway)

/** The cluster choices as options for the form. */
export function join_options (choices, now = Date.now()) {
  return choices.map(ch => {
    const g = ch.gateway
    const state = !g ? 'Not built with Gateway Depot'
      : ch.not_ready ? 'Its control plane, ' + name_of(g) + ', has not finished onboarding'
      : g.online ? 'Control plane ' + name_of(g) + ', in contact'
      : 'Its control plane, ' + name_of(g) + ', is not in contact' + (g.last_seen ? ' (last seen ' + ago(g.last_seen, now) + ')' : '') + ', so it cannot make a join token'
    return {
      value: ch.key,
      title: ch.name,
      disabled: !can_join(ch),
      detail: [ch.hosts ? plural(ch.hosts, 'host') : '', state].filter(Boolean).join(' · '),
    }
  }).concat([{ value: MANUAL, title: 'A cluster that is not listed', detail: 'Needs the cluster’s address and its join token.' }])
}

export const valid_cluster_url = url => /^https:\/\/\S+$/.test(clean(url))

/**
 * Check the form. Returns the problems by field: { cluster, server,
 * url, token }, each a message. An empty object means it can be sent.
 *
 * @param form     the form state
 * @param token    the join token typed, which is never kept in the form
 * @param choices  join_choices(), for a join
 * @param replacing  true when this gateway replaces another
 */
export function validate_onboard (form, token, choices, replacing) {
  const e = {}
  if (replacing || form.mode === 'create') {
    if (!replacing && !clean(form.cluster)) e.cluster = 'Enter a name for the cluster.'
    return e
  }
  const p = (choices ?? []).find(c => c.key === form.server) || null
  if (form.server !== MANUAL && !p) e.server = 'Choose the edge cluster to join.'
  else if (p && !can_join(p)) e.server = 'The control plane of that cluster cannot make a join token yet, so wait or choose another cluster.'
  if (needs_manual(form.server, p)) {
    if (!valid_cluster_url(form.url)) e.url = 'Enter the address in the form https://host:6443.'
    if (!clean(token)) e.token = 'Enter the join token.'
  }
  return e
}

/** The body of the onboard request. */
export function onboard_body (form, token, choices, replacing) {
  if (replacing) return { mode: 'create' }
  if (form.mode === 'create') return { mode: 'create', cluster_name: clean(form.cluster) }
  const p = (choices ?? []).find(c => c.key === form.server) || null
  return p && p.gateway ? { mode: 'join', server: p.gateway.id }
    : { mode: 'join', k3s_url: clean(form.url), k3s_token: clean(token) }
}
