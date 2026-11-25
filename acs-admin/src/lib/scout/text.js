/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * What the Addresses panel says in each state. Kept apart from the
 * component so the wording is tested with the states.
 */

import { code_text, count_text, elapsed_text } from './model.js'

/* What a driver status from `fpEdge1/<Conn>/status` means. */
const DRIVER_STATUS = {
  CONF: 'It has a configuration problem.',
  ADDR: 'It could not read one of the addresses in the origin map.',
  CONN: "It can't reach the device.",
  AUTH: 'The device refused its credentials.',
  DOWN: 'It is stopped.',
  READY: 'It is still starting.',
}

/**
 * The banner for a panel state.
 *
 * @param {object} st From `panel_state`.
 * @param {object} ctx
 * @param {string} [ctx.driver] The driver's name, such as "Modbus".
 * @param {string} [ctx.kind] `mqtt` or `sim` for the empty-scan wording.
 * @param {object} [ctx.status] The trusted status entry.
 * @param {number} [ctx.now] The time now, in ms.
 * @param {object} [ctx.options] The scan options, for the MQTT window.
 * @returns {{tone: string, text: string}|null} Tone is `info`, `warn`,
 *   `error` or `busy`. Null when the state needs no banner.
 */
export function state_banner (st, ctx = {}) {
  const status = ctx.status ?? null
  switch (st.state) {
    case 'hidden':
      return null
    case 'offline':
      return { tone: 'warn', text: 'Unable to scan because the Edge Agent is offline.' }
    case 'agent_old':
      return { tone: 'warn', text: "This Edge Agent can't scan. Upgrade it to the current ACS release." }
    case 'undeployed':
      if (st.message)
        return { tone: 'warn', text: `The Edge Agent can't scan this connection. It said: ${trim(st.message)}` }
      return { tone: 'warn', text: 'Save and deploy this connection before scanning it.' }
    case 'unsupported':
      return {
        tone: 'info',
        text: `The ${ctx.driver ?? 'connection\'s'} driver can't list its addresses. Type them in the metric panel.`,
      }
    case 'driver_old':
      return { tone: 'warn', text: 'This driver was built before scouting. Update the driver image.' }
    case 'driver_down': {
      const why = DRIVER_STATUS[st.message] ?? (st.message ? `It reported ${st.message}.` : '')
      return { tone: 'warn', text: `The driver isn't ready. ${why}`.trim() }
    }
    case 'no_permission':
      return { tone: 'info', text: 'Scanning needs the Scan device addresses permission.' }
    case 'never':
      return {
        tone: 'info',
        text: 'A scan asks the driver to list the addresses its device offers, so you can pick them instead of typing them. Data collection carries on while it runs.',
      }
    case 'sending':
      return { tone: 'busy', text: 'Sending the request to the Edge Agent.' }
    case 'waiting':
      return {
        tone: 'error',
        text: "The Edge Agent didn't record the request. Its log says why, and a missing grant is the usual cause.",
      }
    case 'refused':
      return { tone: st.code === 'BUSY' ? 'info' : 'error', text: code_text(st.code, { message: st.message }) }
    case 'queued':
      return { tone: 'busy', text: 'The scan is waiting for the Edge Agent to start it.' }
    case 'running': {
      const found = status?.progress?.found ?? 0
      const started = status?.started ? Date.parse(status.started) : null
      const time = started && ctx.now ? `, ${elapsed_text(ctx.now - started)}` : ''
      return { tone: 'busy', text: `Found ${count_text(found)}${time}.` }
    }
    case 'done_empty': {
      if (ctx.kind === 'mqtt')
        return { tone: 'info', text: `Nothing was published in the ${ctx.options?.seconds ?? 10} s window.` }
      if (ctx.kind === 'sim')
        return { tone: 'info', text: 'The scan found no addresses. Load a cassette first.' }
      return { tone: 'info', text: 'The scan found no addresses.' }
    }
    case 'done':
      return null
    case 'cancelled':
      return { tone: 'info', text: 'The scan was stopped. The last complete scan is still shown.' }
    case 'interrupted':
    case 'failed':
      return { tone: 'error', text: code_text(st.code, { message: st.message }) }
    default:
      return null
  }
}

/* The panel shows this beside the state banner when the status entry was
 * written by an Edge Agent that does not host the connection. The state
 * machine treats such an entry as missing, so Scan stays available. */
export const UNTRUSTED_TEXT = 'The scan status for this connection was written by an Edge Agent that does not host it, so the panel ignores it. A scan from this connection\'s Edge Agent replaces it.'

function trim (s) {
  const t = String(s).trim().slice(0, 512)
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/** Why two scans cannot say an address is gone. */
export function comparable_text (reason) {
  switch (reason) {
    case 'not-exhaustive':
      return 'This driver cannot list everything, so addresses it did not see are shown as not seen, not gone.'
    case 'truncated':
      return 'One of the scans stopped early, so addresses it did not reach are shown as not seen.'
    case 'options':
      return 'The two scans used different options, so they cannot be compared.'
    case 'root':
      return 'The two scans started in different places, so they cannot be compared.'
    case 'excluded':
      return 'The two scans skipped different parts of the device, so they cannot be compared.'
    default:
      return null
  }
}
