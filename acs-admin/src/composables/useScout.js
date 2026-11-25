/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Edge Scout state for one connection, behind the Addresses panel.
 *
 * It follows four sources. The connection's status entry in ConfigDB is
 * written only by the Edge Agent. The agent's own config says whether the
 * connection is deployed. The agent's births and deaths over Sparkplug say
 * whether it is up and can scan. The operator's ACL says whether they may
 * scan. It sends Node Control/Scout through the Command Escalation
 * service, the way RebirthButton.vue sends a rebirth, and loads snapshots
 * from the Files service through a worker.
 *
 * `create_scout` takes its I/O as functions, so the tests drive every
 * state with fakes. `useScout` wires the real services.
 */

import { computed, reactive, ref, toValue, watch } from 'vue'
import * as rx from 'rxjs'
import { v4 as uuidv4 } from 'uuid'
import { SparkplugApp } from '@amrc-factoryplus/sparkplug-app'
import { Address, UUIDs } from '@amrc-factoryplus/service-client'

import { useServiceClientStore } from '@store/serviceClientStore.js'
import { Scout, SCOUT_METRIC } from '@/lib/scout/constants.js'
import { load_snapshot } from '@/lib/scout/load.js'
import {
  birth_has_scout,
  cancel_request,
  diff,
  has_permission,
  panel_state,
  scout_summary,
  start_request,
} from '@/lib/scout/model.js'

/* Snapshots kept in memory, so a re-scan's previous is not fetched again. */
const CACHE = 3

/**
 * @param {object} opts
 * @param {object} opts.deps I/O functions, see `real_deps`.
 * @param {*} opts.node Ref or getter: the node UUID hosting the connection.
 * @param {*} opts.connection Ref or getter: the connection UUID.
 * @param {*} opts.address Ref or getter: the node's Sparkplug address,
 *   as `group/node`.
 * @param {*} opts.driver Ref or getter: the connection's DriverDef.
 * @param {*} [opts.active] Ref or getter: the panel is open. Births,
 *   online state and the ACL are only followed while it is, because the
 *   Sparkplug watch opens an MQTT connection. The status entry is always
 *   followed, for the item count on the header button.
 * @param {function} [opts.now] Clock, for tests.
 */
export function create_scout ({ deps, node, connection, address, driver, active = true, now = Date.now }) {
  const entry = ref(null)
  const online = ref(null)
  const birth_seen = ref(false)
  const has_metric = ref(false)
  const deployed = ref(null)
  const can_scout = ref(null)
  const pending = ref(null)
  const send_error = ref(null)
  const tick = ref(now())
  const snapshots = reactive({ current: null, previous: null })
  const loading = reactive({ current: false, previous: false })
  const load_error = ref(null)

  const subs = []
  const unsubs = {}
  const cache = new Map()
  let timer = null

  const resub = (name, fn) => {
    unsubs[name]?.unsubscribe?.()
    unsubs[name] = fn()
  }

  /* ---- Sources ---- */

  watch(() => toValue(connection), (conn) => {
    entry.value = null
    resub('status', () => conn && deps.watch_status(conn).subscribe({
      next: v => { entry.value = v ?? null },
      error: e => console.warn('Edge Scout: status watch failed', e),
    }))
  }, { immediate: true })

  watch(() => [toValue(node), toValue(connection)], ([n, conn]) => {
    deployed.value = null
    resub('config', () => n && deps.watch_agent_config(n).subscribe({
      next: cfg => {
        deployed.value = cfg && typeof cfg === 'object'
          ? (cfg.deviceConnections ?? []).some(c => c?.uuid === conn)
          : null
      },
      error: e => console.warn('Edge Scout: agent config watch failed', e),
    }))
  }, { immediate: true })

  watch(() => [toValue(node), toValue(active)], async ([n, on]) => {
    can_scout.value = null
    online.value = null
    if (!n || !on) return
    const [perm, up] = await Promise.all([
      deps.can_scout(n).catch(() => null),
      deps.node_online(n).catch(() => null),
    ])
    if (toValue(node) !== n) return
    can_scout.value = perm
    /* A birth or death that arrived while we asked wins. */
    if (online.value === null) online.value = up
  }, { immediate: true })

  watch(() => [toValue(address), toValue(active)], ([addr, on]) => {
    birth_seen.value = false
    has_metric.value = false
    resub('node', () => addr && on && deps.watch_node(addr).subscribe({
      next: p => {
        if (p.type === 'BIRTH') {
          online.value = true
          birth_seen.value = true
          has_metric.value = birth_has_scout(p.metrics)
        }
        else if (p.type === 'DEATH') online.value = false
      },
      error: e => console.warn('Edge Scout: node watch failed', e),
    }))
  }, { immediate: true })

  /* ---- Derived state ---- */

  const trusted = computed(() => !!entry.value && entry.value.node === toValue(node))
  /* The entry the panel may act on. An entry written by an agent that
   * does not host this connection is ignored. */
  const status = computed(() => (trusted.value ? entry.value : null))

  const state = computed(() => panel_state({
    hidden: toValue(driver)?.scout === false,
    online: online.value,
    birth_seen: birth_seen.value,
    has_metric: has_metric.value,
    entry: entry.value,
    node: toValue(node),
    deployed: deployed.value,
    can_scout: can_scout.value,
    pending: pending.value,
    now: tick.value,
  }))

  /* A request is ours until the agent records it. Accepted, it is
   * forgotten. Refused, it stays so the panel can say why, until someone
   * else's request replaces it in last_request. */
  watch([entry, pending], ([e, p]) => {
    if (!p || !e) return
    const last = e.last_request
    if (e.request === p.request && last?.request !== p.request) pending.value = null
    else if (last?.request === p.request) {
      if (last.code == null) pending.value = null
      else if (!p.refused) pending.value = { ...p, refused: true }
    }
    else if (p.refused) pending.value = null
  })

  /* A send error is about one request. When the agent writes a newer
   * status (another request, a new state or a new scan) the panel has
   * moved on, so the error goes. */
  watch(() => {
    const e = entry.value
    return [e?.request, e?.scan, e?.state, e?.current?.file, e?.last_request?.request]
  }, (next, prev) => {
    if (send_error.value && next.some((v, i) => v !== prev?.[i])) send_error.value = null
  })

  /* Keep the clock running while something on screen depends on it. */
  watch(() => [pending.value, status.value?.state], ([p, s]) => {
    const live = !!p || s === 'queued' || s === 'running'
    if (live && !timer) timer = setInterval(() => { tick.value = now() }, 1000)
    if (!live && timer) { clearInterval(timer); timer = null }
  }, { immediate: true })

  /* ---- Snapshots ---- */

  async function fetch_snapshot (file) {
    if (cache.has(file)) return cache.get(file)
    const p = deps.load(file)
    cache.set(file, p)
    while (cache.size > CACHE) cache.delete(cache.keys().next().value)
    try {
      return await p
    }
    catch (err) {
      cache.delete(file)
      throw err
    }
  }

  function follow_file (which) {
    watch(() => [status.value?.[which]?.file ?? null, !!toValue(active)], async ([file, on]) => {
      if (!file) {
        snapshots[which] = null
        return
      }
      /* Snapshots can be megabytes, so they load when the panel opens. */
      if (!on) return
      loading[which] = true
      try {
        const snap = await fetch_snapshot(file)
        if (status.value?.[which]?.file !== file) return
        snapshots[which] = snap
        if (which === 'current')
          load_error.value = snap.valid ? null : snap.problems.join(' ')
      }
      catch (err) {
        if (which === 'current') load_error.value = String(err?.message ?? err)
        snapshots[which] = null
      }
      finally {
        loading[which] = false
      }
    }, { immediate: true })
  }
  follow_file('current')
  follow_file('previous')

  const current_index = computed(() => (snapshots.current?.valid ? snapshots.current.index : null))
  const previous_index = computed(() => (snapshots.previous?.valid ? snapshots.previous.index : null))

  const changes = computed(() => {
    const st = status.value
    if (!current_index.value || !previous_index.value) return null
    /* After a branch scan only that subtree was looked at again. */
    const scope = st?.state === 'done' && st.folder_id ? st.folder_id : null
    return diff(current_index.value, previous_index.value, {
      cur: st.current, prev: st.previous, scope,
    })
  })

  const summary = computed(() => scout_summary(entry.value, trusted.value))

  /* ---- Actions ---- */

  async function send (body, op) {
    send_error.value = null
    pending.value = { request: body.request, sent: now(), op }
    tick.value = now()
    try {
      await deps.send(toValue(address), body)
    }
    catch (err) {
      pending.value = null
      send_error.value = err?.status === 403
        ? 'The Command Escalation service refused the request. It needs the Scan device addresses permission on this Edge Agent.'
        : `The request did not reach the Edge Agent (${err?.status ?? err?.message ?? err}).`
      return false
    }
    return true
  }

  /** Start a full scan, or a branch scan with `root` and `folder_id`. */
  function start ({ root = null, folder_id = null, options = {} } = {}) {
    return send(start_request({
      request: deps.uuid(),
      connection: toValue(connection),
      root,
      folder_id,
      options,
    }), 'start')
  }

  /** Re-scan one folder and everything below it. */
  function scan_branch (item) {
    return start({
      root: item.root ?? item.id,
      folder_id: item.id,
      options: snapshots.current?.header?.options ?? {},
    })
  }

  function cancel () {
    return send(cancel_request({
      request: deps.uuid(),
      connection: toValue(connection),
    }), 'cancel')
  }

  /** Stop waiting on a refused or missing request. */
  function forget () {
    pending.value = null
    send_error.value = null
  }

  function stop () {
    for (const s of Object.values(unsubs)) s?.unsubscribe?.()
    for (const s of subs) s?.unsubscribe?.()
    if (timer) clearInterval(timer)
    timer = null
  }

  return {
    entry,
    status,
    trusted,
    online,
    birth_seen,
    has_metric,
    deployed,
    can_scout,
    pending,
    send_error,
    state,
    tick,
    snapshots,
    loading,
    load_error,
    current_index,
    previous_index,
    changes,
    summary,
    start,
    scan_branch,
    cancel,
    forget,
    stop,
  }
}

/**
 * The real I/O behind `create_scout`.
 *
 * @param {object} client The logged-in service client.
 */
export function real_deps (client) {
  let app = null
  const spapp = async () => {
    app ??= await new SparkplugApp({ fplus: client }).init()
    return app
  }

  return {
    watch_status: conn => client.ConfigDB.watch_config(Scout.StatusApp, conn),
    watch_agent_config: node => client.ConfigDB.watch_config(UUIDs.App.EdgeAgentConfig, node),

    /* Births and deaths only. Asking for a rebirth would make the
     * agent republish every device, so the panel waits for one and
     * meanwhile takes online state from the Directory. */
    watch_node: addr => rx.from(spapp()).pipe(
      rx.switchMap(a => a.watch_address(Address.parse(addr), ['BIRTH', 'DEATH']))),

    node_online: async node => {
      const [st, info] = await client.Directory.fetch(`v1/device/${node}`)
      return st === 200 ? !!info?.online : null
    },

    /* Ask Auth for our own ACL, as useAccessStore does. Building a
     * Kerberos UPN from the username guessed the realm, and a
     * Keycloak sign-in has no UPN to build. */
    can_scout: async node => {
      const [st, body] = await client.Auth.fetch('v2/whoami/acl')
      if (st !== 200 || !Array.isArray(body?.acl)) return null
      /* Root's access does not show in its ACL. */
      if (body.root) return true
      return has_permission(body.acl, Scout.Perm, node)
    },

    send: (addr, body) => client.CmdEsc.request_cmd({
      address: addr,
      name: SCOUT_METRIC,
      type: 'String',
      value: JSON.stringify(body),
    }),

    load: file => load_snapshot(client, file),
    uuid: () => uuidv4(),
  }
}

/**
 * Edge Scout state for a connection, with the real services.
 *
 * The caller must call `stop()` when it is done, in `beforeUnmount`.
 */
export function useScout ({ node, connection, address, driver, active }) {
  const client = useServiceClientStore().client
  return create_scout({ deps: real_deps(client), node, connection, address, driver, active })
}
