/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The onboarding form: which edge clusters a gateway can join, what the
 * form refuses, and what it sends. Onboarding takes no Factory+
 * administrator login: the service asks the Cluster Manager itself.
 */

import { describe, it, expect } from 'vitest'

import {
  MANUAL, can_join, cluster_key, cluster_name_taken, join_choices, join_options, needs_manual, new_onboard_form,
  onboard_body, valid_cluster_url, validate_onboard,
} from '../src/lib/gateway-depot/onboard.js'

const NOW = 1795090000000

const first = (id, cluster, over = {}) => ({
  id, state: 'onboarded', online: true, last_seen: NOW - 5 * 60 * 1000,
  report: { hostname: 'fpcgw-' + id },
  onboard: { mode: 'create', cluster: { uuid: cluster, name: cluster } },
  ...over,
})
const me = { id: 'me', state: 'ready', online: true, report: { hostname: 'fpcgw-me' } }

/* What GET v1/cluster returns. */
const cluster = (uuid, name, gateway = null, hosts = []) => ({ uuid, name, reported: true, hosts, gateway })

describe('cluster join candidates', () => {
  it('matches each cluster to the gateway the service names', () => {
    const a = first('a', 'c-a')
    const choices = join_choices([cluster('c-a', 'Tapeline', 'a', ['h1', 'h2'])], [a, me], me)
    expect(choices).toEqual([{ key: 'c-a', name: 'Tapeline', gateway: a, not_ready: false, hosts: 2 }])
    expect(can_join(choices[0])).toBe(true)
  })

  it('lists a cluster the depot did not build, which needs an address and a token', () => {
    const [ch] = join_choices([cluster('c-x', 'Legacy')], [me], me)
    expect(ch).toMatchObject({ key: 'c-x', gateway: null, not_ready: false })
    expect(can_join(ch)).toBe(true)
    expect(needs_manual('c-x', ch)).toBe(true)
  })

  it('treats a cluster whose gateway record has been removed the same way', () => {
    const [ch] = join_choices([cluster('c-a', 'Tapeline', 'removed')], [me], me)
    expect(ch.gateway).toBe(null)
    expect(needs_manual('c-a', ch)).toBe(true)
  })

  it('cannot join a cluster whose control plane is not in contact', () => {
    const [ch] = join_choices([cluster('c-a', 'Tapeline', 'a')], [first('a', 'c-a', { online: false }), me], me)
    expect(can_join(ch)).toBe(false)
  })

  it('cannot join a cluster whose control plane has not finished onboarding', () => {
    const [ch] = join_choices([cluster('c-a', 'Tapeline', 'a')], [first('a', 'c-a', { state: 'onboarding' }), me], me)
    expect(ch.not_ready).toBe(true)
    expect(can_join(ch)).toBe(false)
  })

  it('follows a replaced gateway to the one that took over its cluster', () => {
    const old = first('old', 'c-a', { state: 'replaced', online: false, replaced_by: 'new' })
    const fresh = first('new', 'c-a', { replaces: 'old' })
    const [ch] = join_choices([cluster('c-a', 'Tapeline', 'old')], [old, fresh, me], me)
    expect(ch.gateway).toBe(fresh)
    expect(can_join(ch)).toBe(true)
  })

  it('does not offer the cluster this gateway made itself', () => {
    const retry = { ...me, state: 'failed', onboard: { mode: 'create', cluster: { uuid: 'c-me', name_given: 'Mine' } } }
    expect(join_choices([cluster('c-me', 'Mine', 'me'), cluster('c-a', 'Tapeline', 'a')], [first('a', 'c-a'), retry], retry).map(c => c.key))
      .toEqual(['c-a'])
  })

  it('sorts by name, and accepts a host count as well as a host list', () => {
    const choices = join_choices([cluster('2', 'Weld', null, 3), cluster('1', 'Anodise', null, [])], [me], me)
    expect(choices.map(c => [c.name, c.hosts])).toEqual([['Anodise', 0], ['Weld', 3]])
  })

  it('falls back to the gateways when the cluster list has not answered', () => {
    const a = first('a', 'c-a')
    const joiner = { id: 'j', state: 'onboarded', online: true, onboard: { mode: 'join', server: 'a' } }
    const choices = join_choices(null, [a, joiner, first('b', 'c-b', { state: 'onboarding' }), me], me)
    expect(choices.map(c => [c.key, c.gateway.id])).toEqual([['c-a', 'a']])
  })

  it('describes each choice, and always offers a cluster that is not listed', () => {
    const list = [
      cluster('1', 'Anodise', 'up', ['h1']),
      cluster('2', 'Bond', 'down', ['h1', 'h2']),
      cluster('3', 'Cure', 'busy'),
      cluster('4', 'Legacy'),
    ]
    const gateways = [first('up', '1'), first('down', '2', { online: false }), first('busy', '3', { state: 'onboarding' }), me]
    expect(join_options(join_choices(list, gateways, me), NOW)).toEqual([
      { value: '1', title: 'Anodise', disabled: false, detail: '1 host · Control plane fpcgw-up, in contact' },
      { value: '2', title: 'Bond', disabled: true, detail: '2 hosts · Its control plane, fpcgw-down, is not in contact (last seen 5 minutes ago), so it cannot make a join token' },
      { value: '3', title: 'Cure', disabled: true, detail: 'Its control plane, fpcgw-busy, has not finished onboarding' },
      { value: '4', title: 'Legacy', disabled: false, detail: 'Not built with Gateway Depot' },
      { value: MANUAL, title: 'A cluster that is not listed', detail: 'Needs the cluster’s address and its join token.' },
    ])
  })
})

describe('the cluster name', () => {
  const clusters = [cluster('1', 'Tape Line 2'), cluster('2', 'Weld')]

  it('compares names the way Factory+ does', () => {
    expect(cluster_key(' Tape-Line  2 ')).toBe('tape_line_2')
    expect(cluster_name_taken('tape_line-2', clusters, me)).toBe(true)
    expect(cluster_name_taken('Tapeline', clusters, me)).toBe(false)
  })

  it('does not warn about the name this gateway already gave', () => {
    const retry = { ...me, state: 'failed', onboard: { mode: 'create', cluster: { uuid: '2', name: 'Weld', name_given: 'Weld' } } }
    expect(cluster_name_taken('Weld', clusters, retry)).toBe(false)
    expect(cluster_name_taken('Weld', clusters, me)).toBe(true)
  })

  it('says nothing until there is a name and a cluster list', () => {
    expect(cluster_name_taken('', clusters, me)).toBe(false)
    expect(cluster_name_taken('Weld', null, me)).toBe(false)
  })

  it('starts from the gateway\'s hostname', () => {
    expect(new_onboard_form(me)).toEqual({ mode: 'create', cluster: 'fpcgw-me', server: null, url: '', touchedCluster: false })
  })
})

describe('validating and sending', () => {
  const a = first('a', 'c-a')
  const choices = join_choices([cluster('c-a', 'Tapeline', 'a'), cluster('c-x', 'Legacy'), cluster('c-d', 'Down', 'd')],
    [a, first('d', 'c-d', { online: false }), me], me)
  const form = over => ({ ...new_onboard_form(me), ...over })

  it('creating a cluster needs only its name', () => {
    expect(validate_onboard(form({ cluster: ' ' }), '', choices, false)).toEqual({ cluster: 'Enter a name for the cluster.' })
    expect(validate_onboard(form({ cluster: 'Tapeline' }), '', choices, false)).toEqual({})
    expect(onboard_body(form({ cluster: ' Tapeline ' }), '', choices, false)).toEqual({ mode: 'create', cluster_name: 'Tapeline' })
  })

  it('a replacement gateway needs nothing but the button', () => {
    expect(validate_onboard(form({ cluster: '', mode: 'join' }), '', choices, true)).toEqual({})
    expect(onboard_body(form({ cluster: 'ignored', mode: 'join', server: 'c-a' }), 'secret', choices, true)).toEqual({ mode: 'create' })
  })

  it('never sends a username or a password', () => {
    for (const body of [
      onboard_body(form({ cluster: 'Tapeline' }), '', choices, false),
      onboard_body(form({}), '', choices, true),
      onboard_body(form({ mode: 'join', server: 'c-a' }), '', choices, false),
    ]) {
      expect(body).not.toHaveProperty('username')
      expect(body).not.toHaveProperty('password')
    }
  })

  it('joining a cluster the depot built sends its first gateway', () => {
    expect(validate_onboard(form({ mode: 'join', server: 'c-a' }), '', choices, false)).toEqual({})
    expect(onboard_body(form({ mode: 'join', server: 'c-a' }), '', choices, false)).toEqual({ mode: 'join', server: 'a' })
  })

  it('joining needs a cluster to be chosen, and one that can make a token', () => {
    expect(validate_onboard(form({ mode: 'join' }), '', choices, false)).toEqual({ server: 'Choose the edge cluster to join.' })
    expect(validate_onboard(form({ mode: 'join', server: 'c-gone' }), '', choices, false)).toEqual({ server: 'Choose the edge cluster to join.' })
    expect(validate_onboard(form({ mode: 'join', server: 'c-d' }), '', choices, false)).toEqual({
      server: 'The control plane of that cluster cannot make a join token yet, so wait or choose another cluster.',
    })
  })

  it('joining a cluster the depot did not build needs its address and token', () => {
    for (const server of ['c-x', MANUAL]) {
      expect(validate_onboard(form({ mode: 'join', server }), ' ', choices, false)).toEqual({
        url: 'Enter the address in the form https://host:6443.',
        token: 'Enter the join token.',
      })
      const full = form({ mode: 'join', server, url: ' https://10.31.4.9:6443 ' })
      expect(validate_onboard(full, 'K10abc::server:xyz', choices, false)).toEqual({})
      expect(onboard_body(full, ' K10abc::server:xyz ', choices, false))
        .toEqual({ mode: 'join', k3s_url: 'https://10.31.4.9:6443', k3s_token: 'K10abc::server:xyz' })
    }
  })

  it('checks the cluster address', () => {
    expect(valid_cluster_url('https://host:6443')).toBe(true)
    for (const bad of ['', 'host:6443', 'http://host:6443', 'https://', 'https://ho st'])
      expect(valid_cluster_url(bad), bad).toBe(false)
  })
})
