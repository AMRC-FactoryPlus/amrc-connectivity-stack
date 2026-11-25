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
 * While live values are on it holds a lease on the agent, with `watch`
 * and `unwatch` through the same service, and follows the connection's
 * values entry in ConfigDB.
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
import {
  LIVE_DEBOUNCE_MS,
  LIVE_RENEW_MS,
  Scout,
  SCOUT_METRIC,
} from '@/lib/scout/constants.js'
import { load_snapshot } from '@/lib/scout/load.js'
import { unwatch_request, watch_addresses, watch_request } from '@/lib/scout/live.js'
import { watch_refusal_text, watch_send_error_text } from '@/lib/scout/text.js'
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
  const live = ref(false)
  const live_error = ref(null)
  const live_entry = ref(null)
  const live_addresses = ref([])

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
  watch(() => [pending.value, status.value?.state, live.value], ([p, s, l]) => {
    const ticking = !!p || s === 'queued' || s === 'running' || l
    if (ticking && !timer) timer = setInterval(() => { tick.value = now() }, 1000)
    if (!ticking && timer) { clearInterval(timer); timer = null }
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


  /* ---- Live values ---- */

  /* One lease per time the switch is turned on. `held` is whether the
   * agent may hold it now, so turning off only sends unwatch when there
   * is something to end. */
  const lease = { id: null, held: false, sent: null, renew: null, debounce: null, hidden: null }
  /* The watch requests of this lease, so a refusal in last_request can
   * be told apart from one for a scan or another panel. */
  const watch_ids = new Set()

  /** Why the switch is disabled, or null when it can be turned on. */
  const live_blocked = computed(() => {
    if (online.value === false) return 'offline'
    if (can_scout.value === false) return 'no_permission'
    const reads = status.value?.reads
    if (reads === false) return 'noreads'
    if (reads !== true) return 'unknown'
    return null
  })

  /* The entry the panel may show. One written by an agent that does not
   * host this connection is ignored, as for the status entry. */
  const live_values = computed(() => {
    const e = live_entry.value
    return live.value && e && e.node === toValue(node) ? e : null
  })

  async function send_live (body) {
    try {
      await deps.send(toValue(address), body)
    }
    catch (err) {
      if (body.op === 'watch' && body.lease === lease.id) {
        live_error.value = watch_send_error_text(err)
        live_off()
      }
    }
  }

  /* Ask for the addresses on screen. A renewal sends them again even
   * when they have not changed, which keeps the lease alive. */
  function send_watch (renew = false) {
    if (!live.value) return
    const list = live_addresses.value
    const key = JSON.stringify(list)
    if (!renew && key === lease.sent) return
    lease.sent = key
    if (!list.length) {
      /* Nothing on screen to read. A watch needs at least one address,
       * so end the lease until there is. */
      if (lease.held) {
        lease.held = false
        send_live(unwatch_request({ request: deps.uuid(), connection: toValue(connection), lease: lease.id }))
      }
      return
    }
    const body = watch_request({
      request: deps.uuid(),
      connection: toValue(connection),
      lease: lease.id,
      addresses: list,
    })
    watch_ids.add(body.request)
    lease.held = true
    send_live(body)
  }

  /** Turn live values on, after the operator has confirmed. */
  function live_on () {
    if (live.value || live_blocked.value) return false
    live_error.value = null
    watch_ids.clear()
    live.value = true
    lease.id = deps.uuid()
    lease.held = false
    lease.sent = null
    live_entry.value = null
    resub('values', () => deps.watch_values(toValue(connection)).subscribe({
      next: v => { live_entry.value = v ?? null },
      error: e => console.warn('Edge Scout: values watch failed', e),
    }))
    lease.renew = setInterval(() => send_watch(true), LIVE_RENEW_MS)
    lease.hidden = deps.on_hidden?.(() => live_off()) ?? null
    send_watch()
    return true
  }

  /** Turn live values off and end the lease. */
  function live_off () {
    if (!live.value) return
    live.value = false
    clearInterval(lease.renew)
    clearTimeout(lease.debounce)
    lease.hidden?.()
    lease.renew = lease.debounce = lease.hidden = null
    unsubs.values?.unsubscribe?.()
    delete unsubs.values
    live_entry.value = null
    if (lease.held)
      send_live(unwatch_request({ request: deps.uuid(), connection: toValue(connection), lease: lease.id }))
    lease.held = false
    lease.id = null
  }

  /**
   * Tell the composable which value items are on screen, in screen
   * order. While live values are on, a change is sent after 1 s.
   */
  function set_live_items (items) {
    const next = watch_addresses(items)
    if (JSON.stringify(next) === JSON.stringify(live_addresses.value)) return
    live_addresses.value = next
    if (!live.value) return
    clearTimeout(lease.debounce)
    lease.debounce = setTimeout(() => send_watch(), LIVE_DEBOUNCE_MS)
  }

  /* A refused watch stops live values and says why. An accepted one
   * writes nothing, so only refusals show up here. */
  watch(() => entry.value?.last_request, last => {
    if (!live.value || !last?.code || !watch_ids.has(last.request)) return
    live_error.value = watch_refusal_text(last.code, { message: last.message ?? null })
    lease.held = false
    live_off()
  })

  /* Live values stop when the agent goes offline, the panel closes or
   * the connection changes. */
  watch(online, up => { if (up === false) live_off() })
  watch(() => toValue(active), on => { if (!on) live_off() })
  watch(() => toValue(connection), () => live_off())

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
    live_off()
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
    live,
    live_error,
    live_blocked,
    live_values,
    live_addresses,
    live_on,
    live_off,
    set_live_items,
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
    watch_values: conn => client.ConfigDB.watch_config(Scout.ValuesApp, conn),

    /* Calls `fn` when the browser tab is hidden, and returns a function
     * that stops listening. */
    on_hidden: fn => {
      const handler = () => { if (document.visibilityState === 'hidden') fn() }
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    },
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
