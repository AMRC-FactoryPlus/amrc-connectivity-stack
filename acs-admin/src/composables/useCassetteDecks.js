/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The deck engine behind the Cassette Decks page.
 *
 * A deck is one device on a connection that uses the Simulator driver.
 * Deck state is read live from the device's Player_Controls metrics
 * over Sparkplug; transport actions are DCMDs sent through the Command
 * Escalation service, so everything on screen is an authorised
 * command against a live device.
 */

import { reactive, computed } from 'vue'
import { SparkplugApp } from '@amrc-factoryplus/sparkplug-app'

import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useConnectionStore } from '@store/useConnectionStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { useSchemaStore } from '@store/useSchemaStore.js'
import { EdgeSim, PlayerMetric } from '@/lib/edge-sim-uuids.js'

const ACK_TIMEOUT = 5000

const freshRuntime = () => ({
  /* False until the first Sparkplug packet arrives, so a fresh page
   * shows "waiting" rather than wrongly asserting offline. */
  seen: false,
  online: false,
  status: 'EMPTY',       // EMPTY | LOADED | LOADING | PLAYING | PAUSED | ENDED
  cassette: null,        // uuid of the loaded cassette
  lastCassette: null,    // last uuid we saw loaded (for Reload)
  position: 0,           // ms into the cassette
  rateActual: 0,
  selectedRate: 1,       // rate the next Play will use
  loopSelected: false,   // whether the next Play loops
  /* Virtual-clock estimate: wall time when the current playback's
   * stamps started. Stamps are start_time + position; Play without an
   * explicit start time stamps from the moment the driver receives
   * it, so the moment we saw PLAYING begin is a close estimate. */
  playStartWall: null,
  strip: null,           // { kind: 'error'|'info'|'offline', title?, text, action? }
  pending: null,         // { verb, timer } awaiting acknowledgement
  dragOver: false,
})

export function useCassetteDecks () {
  const devices = useDeviceStore()
  const connections = useConnectionStore()
  const nodes = useNodeStore()
  const schemas = useSchemaStore()

  /* Per-device runtime state, keyed by device uuid. Populated lazily
   * so Vue reactivity picks the entries up. */
  const runtime = reactive({})
  const rt = uuid => {
    if (!runtime[uuid]) runtime[uuid] = freshRuntime()
    return runtime[uuid]
  }

  /* Sparkplug subscriptions, keyed by device uuid. */
  const subs = new Map()
  let spApp = null

  /* ---- Deck discovery ---- */

  const simConnections = computed(() => new Set(
    connections.data
      .filter(c => c.configuration?.driver_uuid === EdgeSim.Driver
        || c.configuration?.driver === EdgeSim.Driver)
      .map(c => c.uuid)))

  const decks = computed(() => devices.data
    .filter(d => d.deviceInformation?.connection
      && simConnections.value.has(d.deviceInformation.connection))
    .map(d => {
      const node = nodes.data.find(n => n.uuid === d.deviceInformation?.node)
      const addr = node?.sparkplugAddress
      const address = addr
        ? `${addr.group_id}/${addr.node_id}/${d.deviceInformation.sparkplugName}`
        : null
      const schema = schemas.data
        .find(sc => sc.uuid === d.deviceInformation?.schema)
      /* Every device on the same connection shares ONE driver and so
       * ONE player: identical data on every device, and commands
       * race. Surface it loudly on the deck. */
      const housemates = devices.data
        .filter(o => o.uuid !== d.uuid
          && o.deviceInformation?.connection === d.deviceInformation.connection)
        .map(o => o.name ?? o.deviceInformation?.sparkplugName)
      return {
        uuid: d.uuid,
        name: d.name ?? d.deviceInformation?.sparkplugName ?? 'Device',
        address,
        nodeUuid: d.deviceInformation?.node,
        schemaName: schema?.schemaInformation?.name ?? null,
        sharedWith: housemates,
        rt: rt(d.uuid),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name)))

  /* ---- Live state ---- */

  async function start () {
    const client = useServiceClientStore().client
    spApp = await new SparkplugApp({ fplus: client }).init()
    /* Subscriptions attach per-deck as decks appear. */
  }

  function watchDeck (deck) {
    if (!deck.address || subs.has(deck.uuid)) return
    const dev = spApp.device({ address: deck.address })
    const state = rt(deck.uuid)

    const metricSub = dev.metrics.subscribe(m => {
      switch (m.name) {
      case PlayerMetric.Status:
        applyStatus(deck, String(m.value))
        break
      case PlayerMetric.Cassette: {
        const v = String(m.value ?? '')
        state.cassette = v || null
        if (v) state.lastCassette = v
        break
      }
      case PlayerMetric.Position:
        state.position = Number(m.value) || 0
        break
      case PlayerMetric.RateActual:
        state.rateActual = Number(m.value) || 0
        break
      case PlayerMetric.Error:
        if (m.value) setStrip(deck, {
          kind: 'error',
          title: 'Device error',
          text: String(m.value),
        })
        break
      }
    })

    const packetSub = dev.packets.subscribe(p => {
      state.seen = true
      if (p.type === 'BIRTH') {
        state.online = true
        if (state.strip?.kind === 'offline') state.strip = null
      }
      if (p.type === 'DEATH') {
        state.online = false
        setStrip(deck, {
          kind: 'offline',
          text: `Device offline since ${clock(Date.now())}. The edge agent `
            + 'is not reporting, so transport commands are unavailable '
            + 'until it reconnects.',
        })
      }
    })

    subs.set(deck.uuid, [metricSub, packetSub])
  }

  function applyStatus (deck, status) {
    const state = rt(deck.uuid)
    const previous = state.status
    state.status = status
    state.seen = true
    state.online = true

    if (status === 'PLAYING' && previous !== 'PLAYING')
      state.playStartWall ??= Date.now() - state.position
    if (status !== 'PLAYING' && status !== 'PAUSED' && status !== 'ENDED')
      state.playStartWall = null

    /* The driver rebuilds on device-config changes and comes back
     * EMPTY. If we did not eject, say what happened and offer Reload. */
    if (status === 'EMPTY' && (previous === 'LOADED' || previous === 'PLAYING'
        || previous === 'PAUSED' || previous === 'ENDED')
        && state.pending?.verb !== 'eject' && state.lastCassette) {
      setStrip(deck, {
        kind: 'info',
        text: `Cassette unloaded. The device configuration changed at `
          + `${clock(Date.now())}, which resets the player.`,
        action: 'reload',
      })
    }

    acknowledge(deck, status)
  }

  /* ---- Commands ---- */

  async function command (deck, verb, name, type, value, expect) {
    const client = useServiceClientStore().client
    const state = rt(deck.uuid)
    state.strip = null
    clearPending(deck)

    try {
      await client.CmdEsc.request_cmd({
        address: deck.address, name, type, value,
      })
    }
    catch (err) {
      const refused = err?.status === 403
      setStrip(deck, {
        kind: 'error',
        title: `${cap(verb)} refused`,
        text: refused
          ? 'You do not hold the Control simulator player permission on '
            + 'this device. An administrator can grant it in Access Control.'
          : `The platform rejected the command (${err?.status ?? err}).`,
      })
      return false
    }

    if (expect) {
      state.pending = {
        verb,
        expect,
        timer: setTimeout(() => {
          state.pending = null
          setStrip(deck, {
            kind: 'error',
            title: `${cap(verb)} refused`,
            text: 'The device did not acknowledge the command within 5 seconds.',
          })
        }, ACK_TIMEOUT),
      }
    }
    return true
  }

  function acknowledge (deck, status) {
    const state = rt(deck.uuid)
    if (state.pending?.expect?.includes(status)) clearPending(deck)
  }

  function clearPending (deck) {
    const state = rt(deck.uuid)
    if (state.pending?.timer) clearTimeout(state.pending.timer)
    state.pending = null
  }

  const actions = {
    async load (deck, cassetteUuid) {
      const state = rt(deck.uuid)
      const ok = await command(deck, 'load', PlayerMetric.Load,
        'String', cassetteUuid, ['LOADED'])
      if (ok) state.status = 'LOADING'
    },
    play (deck) {
      const state = rt(deck.uuid)
      const args = {}
      if (state.selectedRate !== 1) args.rate = state.selectedRate
      if (state.loopSelected) args.loop = true
      return command(deck, 'play', PlayerMetric.Play,
        'String', JSON.stringify(args), ['PLAYING'])
    },
    pause: deck => command(deck, 'pause', PlayerMetric.Pause,
      'Boolean', true, ['PAUSED']),
    stop: deck => command(deck, 'stop', PlayerMetric.Stop,
      'Boolean', true, ['LOADED']),
    eject: deck => command(deck, 'eject', PlayerMetric.Eject,
      'Boolean', true, ['EMPTY']),
    seek: (deck, positionMs) => command(deck, 'seek', PlayerMetric.Seek,
      'String', String(Math.max(0, Math.round(positionMs))), null),
    setRate (deck, rate) {
      const state = rt(deck.uuid)
      state.selectedRate = rate
      /* Mid-play a rate write repaces the running playback. */
      if (state.status === 'PLAYING')
        return command(deck, 'rate', PlayerMetric.Rate,
          'String', String(rate), null)
    },
    reload (deck) {
      const state = rt(deck.uuid)
      if (state.lastCassette) return actions.load(deck, state.lastCassette)
    },
    dismiss (deck) { rt(deck.uuid).strip = null },
    stopAll () {
      return Promise.allSettled(decks.value
        .filter(d => ['PLAYING', 'PAUSED'].includes(d.rt.status))
        .map(d => actions.stop(d)))
    },
  }

  function setStrip (deck, strip) { rt(deck.uuid).strip = strip }

  function stop () {
    for (const list of subs.values()) list.forEach(s => s.unsubscribe())
    subs.clear()
    for (const uuid of Object.keys(runtime)) clearPending({ uuid })
  }

  return { decks, runtime, actions, start, stop, watchDeck }
}

/* ---- Small formatting helpers shared with the components ---- */

export const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

export const clock = ms => new Date(ms).toLocaleTimeString('en-GB',
  { hour: '2-digit', minute: '2-digit' })

export const mmss = ms => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export const drift = ms => {
  const s = Math.abs(Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}
