/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * What the Addresses panel says in each state.
 */

import { describe, it, expect } from 'vitest'

import { UNTRUSTED_TEXT, comparable_text, state_banner } from '../src/lib/scout/text.js'

const STATES = ['hidden', 'offline', 'agent_old', 'untrusted', 'undeployed', 'unsupported', 'driver_old',
  'driver_down', 'no_permission', 'never', 'sending', 'waiting', 'refused', 'queued', 'running',
  'done_empty', 'done', 'failed', 'cancelled', 'interrupted']

describe('state_banner', () => {
  it('uses plain prose with no dashes or semicolons in every state', () => {
    for (const state of STATES) {
      const b = state_banner({ state, code: 'TIMEOUT', message: 'CONF' }, { driver: 'Modbus' })
      if (!b) continue
      expect(b.text, state).not.toMatch(/[—–;]/)
      expect(b.text, state).not.toMatch(/\b(simple|easy|just)\b/i)
    }
  })

  it('words the untrusted warning plainly and says how to fix it', () => {
    expect(UNTRUSTED_TEXT).not.toMatch(/[—–;]/)
    expect(UNTRUSTED_TEXT).toContain('replaces it')
  })

  it('shows no banner when hidden or done', () => {
    expect(state_banner({ state: 'hidden' })).toBeNull()
    expect(state_banner({ state: 'done' })).toBeNull()
  })

  it('says what the spec table says', () => {
    expect(state_banner({ state: 'offline' }).text).toBe('Unable to scan because the Edge Agent is offline.')
    expect(state_banner({ state: 'agent_old' }).text)
      .toBe("This Edge Agent can't scan. Upgrade it to the current ACS release.")
    expect(state_banner({ state: 'undeployed' }).text).toBe('Save and deploy this connection before scanning it.')
    expect(state_banner({ state: 'undeployed', message: 'It is not a split driver' }).text)
      .toBe("The Edge Agent can't scan this connection. It said: It is not a split driver.")
    expect(state_banner({ state: 'unsupported' }, { driver: 'Modbus' }).text)
      .toBe("The Modbus driver can't list its addresses. Type them in the metric panel.")
    expect(state_banner({ state: 'driver_old' }).text)
      .toBe('This driver was built before scouting. Update the driver image.')
    expect(state_banner({ state: 'waiting' }).text)
      .toBe("The Edge Agent didn't record the request. Its log says why, and a missing grant is the usual cause.")
  })

  it('names the driver status when the driver is not running', () => {
    expect(state_banner({ state: 'driver_down', message: 'CONF' }).text)
      .toBe("The driver isn't ready. It has a configuration problem.")
    expect(state_banner({ state: 'driver_down', message: 'ODD' }).text)
      .toBe("The driver isn't ready. It reported ODD.")
  })

  it('shows the live count and elapsed time while running', () => {
    const status = { started: '2026-11-24T10:00:00Z', progress: { found: 3420 } }
    const now = Date.parse('2026-11-24T10:00:41Z')
    expect(state_banner({ state: 'running' }, { status, now }).text).toBe('Found 3,420 addresses, 41 s.')
  })

  it('words an empty scan by driver', () => {
    expect(state_banner({ state: 'done_empty' }).text).toBe('The scan found no addresses.')
    expect(state_banner({ state: 'done_empty' }, { kind: 'mqtt' }).text)
      .toBe('Nothing was published in the 10 s window.')
    expect(state_banner({ state: 'done_empty' }, { kind: 'mqtt', options: { seconds: 30 } }).text)
      .toBe('Nothing was published in the 30 s window.')
    expect(state_banner({ state: 'done_empty' }, { kind: 'sim' }).text)
      .toBe('The scan found no addresses. Load a cassette first.')
  })

  it('explains why scans cannot be compared', () => {
    for (const r of ['not-exhaustive', 'truncated', 'options', 'root', 'excluded'])
      expect(comparable_text(r)).toMatch(/\.$/)
    expect(comparable_text(null)).toBeNull()
  })
})
