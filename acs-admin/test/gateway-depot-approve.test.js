/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * The approval form: the starting choices for the ports and the disk,
 * how they follow the live gateway until a person chooses, what the
 * form refuses, and what it sends. Approving erases a disk, so the
 * confirmation is checked too.
 */

import { describe, it, expect } from 'vitest'

import {
  approve_body, approve_view, erase_lines, new_approve_form, old_choices, south_after_north, suggest_disk,
  suggest_north, valid_admin_user, valid_south_addr, valid_ssh_keys, validate_approve,
} from '../src/lib/gateway-depot/approve.js'

const A = '00:e0:4c:68:01:a1', B = '00:e0:4c:68:01:a2', C = '00:e0:4c:68:01:a3'
const nic = (name, mac, link = false, ipv4 = '') => ({ name, mac, link, speed: '1000', ipv4 })
const NVME = { path: '/dev/nvme0n1', size: 256060514304, model: 'SAMSUNG MZVLB256', serial: 'S4X', transport: 'nvme' }
const SATA = { path: '/dev/sda', size: 1000204886016, model: 'WDC WD10', serial: 'W1', transport: 'sata' }
const STICK = { path: '/dev/sdb', size: 2000398934016, model: 'Ultra Fit', serial: 'U1', transport: 'usb' }

const pending = (nics, disks = [NVME]) => ({
  id: 'new', state: 'pending', online: true,
  inventory: { serial: 'PF550F40', vendor: 'LENOVO', model: 'ThinkEdge SE30', nics, disks },
})

describe('default port guesses', () => {
  it('takes the port that has an address as northbound', () => {
    expect(suggest_north([nic('enp1s0', A), nic('enp2s0', B, true, '10.31.4.57/24')])).toBe(B)
  })

  it('takes the only port as northbound even without an address', () => {
    expect(suggest_north([nic('enp1s0', A)])).toBe(A)
  })

  it('does not guess between several ports with no address', () => {
    expect(suggest_north([nic('enp1s0', A), nic('enp2s0', B)])).toBe(null)
    expect(suggest_north([])).toBe(null)
  })

  it('with exactly two ports, makes the other one southbound', () => {
    const v = approve_view(new_approve_form('fplus'), pending([nic('enp1s0', A, true, '10.31.4.57/24'), nic('enp2s0', B)]))
    expect(v.north).toBe(A)
    expect(v.south).toBe(B)
    expect(v.north_options.map(o => o.hint)).toEqual(['Suggested', ''])
  })

  it('with three ports, leaves southbound for the person to choose', () => {
    const v = approve_view(new_approve_form(), pending([nic('enp1s0', A, true, '10.31.4.57/24'), nic('enp2s0', B), nic('enp3s0', C)]))
    expect(v.north).toBe(A)
    expect(v.south).toBe(null)
  })

  it('with one port, chooses no southbound port and says why', () => {
    const v = approve_view(new_approve_form(), pending([nic('enp1s0', A)]))
    expect(v.north).toBe(A)
    expect(v.south).toBe('')
    expect(v.north_options[0].hint).toBe('The only port')
    expect(v.south_options.at(-1)).toEqual({ value: '', title: 'No southbound port', detail: 'This gateway has one port.' })
  })

  it('follows the cable: the guess moves when the address moves', () => {
    const form = new_approve_form()
    let v = approve_view(form, pending([nic('enp1s0', A, true, '10.31.4.57/24'), nic('enp2s0', B)]))
    Object.assign(form, { north: v.north, south: v.south })
    v = approve_view(form, pending([nic('enp1s0', A), nic('enp2s0', B, true, '10.31.4.57/24')]))
    expect([v.north, v.south]).toEqual([B, A])
  })

  it('stops following once the person has chosen', () => {
    const form = { ...new_approve_form(), north: B, south: A, touched: { north: true, south: true } }
    const v = approve_view(form, pending([nic('enp1s0', A, true, '10.31.4.57/24'), nic('enp2s0', B)]))
    expect([v.north, v.south]).toEqual([B, A])
  })

  it('drops a choice whose port has gone', () => {
    const form = { ...new_approve_form(), north: C, south: B, touched: { north: true, south: true } }
    const v = approve_view(form, pending([nic('enp1s0', A), nic('enp2s0', B)]))
    expect(v.north).toBe(null)
    expect(v.south).toBe(B)
  })

  it('never leaves one port as both northbound and southbound', () => {
    /* Southbound was chosen by hand, then the address turned up on it. */
    const form = { ...new_approve_form(), south: B, touched: { south: true } }
    const v = approve_view(form, pending([nic('enp1s0', A), nic('enp2s0', B, true, '10.31.4.57/24'), nic('enp3s0', C)]))
    expect(v.north).toBe(B)
    expect(v.south).toBe(null)
    expect(v.south_options.find(o => o.value === B)).toMatchObject({ disabled: true, detail: 'Already chosen as the northbound port' })
  })

  it('moves southbound out of the way when a person takes its port as northbound', () => {
    const two = [nic('enp1s0', A), nic('enp2s0', B)]
    expect(south_after_north(B, B, two)).toBe(A)
    expect(south_after_north(B, B, [...two, nic('enp3s0', C)])).toBe(null)
    expect(south_after_north('', B, two)).toBe('')
    expect(south_after_north(A, B, two)).toBe(A)
  })

  it('ignores a port with no MAC address', () => {
    const v = approve_view(new_approve_form(), pending([nic('enp1s0', A, true, '10.31.4.57/24'), nic('wlan0', '')]))
    expect(v.nics.map(n => n.mac)).toEqual([A])
    expect(v.south).toBe('')
  })
})

describe('default disk guess', () => {
  it('takes the largest disk', () => {
    expect(suggest_disk([NVME, SATA]).path).toBe('/dev/sda')
  })

  it('does not take a USB disk while there is another, however large', () => {
    expect(suggest_disk([STICK, NVME]).path).toBe('/dev/nvme0n1')
  })

  it('takes a USB disk when it is all there is', () => {
    expect(suggest_disk([STICK]).path).toBe('/dev/sdb')
    expect(suggest_disk([])).toBe(null)
  })

  it('flags a USB disk, and marks the suggestion', () => {
    const v = approve_view(new_approve_form(), pending([nic('enp1s0', A)], [STICK, NVME, SATA]))
    expect(v.disk).toBe('/dev/sda')
    expect(v.disk_options.map(o => o.hint)).toEqual(['This may be the depot USB stick', '', 'Suggested'])
    expect(v.disk_options[1].detail).toBe('256 GB · SAMSUNG MZVLB256 · NVMe · serial S4X')
  })

  it('says when there is only one disk, and keeps a choice the person made', () => {
    expect(approve_view(new_approve_form(), pending([nic('enp1s0', A)])).disk_options[0].hint).toBe('The only disk')
    const form = { ...new_approve_form(), disk: '/dev/nvme0n1', touched: { disk: true } }
    expect(approve_view(form, pending([nic('enp1s0', A)], [NVME, SATA])).disk).toBe('/dev/nvme0n1')
  })

  it('drops a chosen disk that has gone, and has nothing to offer with no disks', () => {
    const form = { ...new_approve_form(), disk: '/dev/sdz', touched: { disk: true } }
    expect(approve_view(form, pending([nic('enp1s0', A)], [NVME])).disk).toBe(null)
    const none = approve_view(new_approve_form(), pending([nic('enp1s0', A)], []))
    expect(none.disk).toBe(null)
    expect(none.disks).toEqual([])
  })
})

describe('replacing a gateway', () => {
  const old = {
    id: 'old', state: 'onboarded', online: false,
    settings: { north_mac: 'x', south_mac: 'y', south_addr: '192.168.1.200/24', admin_user: 'cell', label: 'tapeline' },
    report: { hostname: 'fpcgw-old', north: 'enp2s0', south: 'enp1s0' },
    onboard: { mode: 'create', cluster: { uuid: 'c', name: 'Tapeline' } },
  }

  it('starts from the old gateway\'s port names, not the live address', () => {
    const v = approve_view(new_approve_form(), pending([nic('enp1s0', A, true, '10.31.4.57/24'), nic('enp2s0', B), nic('enp3s0', C)]), old)
    expect([v.north, v.south]).toEqual([B, A])
    expect(v.north_options[1].hint).toBe('Suggested')
  })

  it('chooses no southbound port when the old gateway had none', () => {
    const lone = { ...old, report: { hostname: 'fpcgw-old', north: 'enp2s0' } }
    const v = approve_view(new_approve_form(), pending([nic('enp1s0', A), nic('enp2s0', B), nic('enp3s0', C)]), lone)
    expect([v.north, v.south]).toEqual([B, ''])
  })

  it('falls back to the live ports when the names do not match', () => {
    const v = approve_view(new_approve_form(), pending([nic('eno1', A, true, '10.31.4.57/24'), nic('eno2', B)]), old)
    expect([v.north, v.south]).toEqual([A, B])
  })

  it('prefills from the old settings, but not over what was typed', () => {
    expect(old_choices(new_approve_form('fplus'), old)).toEqual({ addr: '192.168.1.200/24', admin: 'cell', note: 'tapeline' })
    const form = { ...new_approve_form('fplus'), addr: 'dhcp', touched: { addr: true, note: true } }
    expect(old_choices(form, old)).toEqual({ admin: 'cell' })
    expect(old_choices(new_approve_form(), { id: 'bare' })).toEqual({})
  })

  it('sends which gateway it replaces and whether to keep its hostname', () => {
    const form = { ...new_approve_form('fplus'), north: A, south: '', disk: '/dev/nvme0n1', keepName: false }
    expect(approve_body(form, old)).toMatchObject({ replaces: 'old', keep_hostname: false })
    expect(approve_body(form)).not.toHaveProperty('replaces')
    expect(approve_body(form)).not.toHaveProperty('keep_hostname')
  })
})

describe('validating the southbound address', () => {
  it('accepts an address with a prefix length', () => {
    for (const ok of ['192.168.1.200/24', '10.0.0.1/8', '0.0.0.0/0', '255.255.255.255/32', ' 172.16.4.2/30 '])
      expect(valid_south_addr(ok), ok).toBe(true)
  })

  it('accepts the word dhcp in any case', () => {
    for (const ok of ['dhcp', 'DHCP', ' Dhcp '])
      expect(valid_south_addr(ok), ok).toBe(true)
  })

  it('refuses anything else', () => {
    for (const bad of ['', '192.168.1.200', '192.168.1.200/', '192.168.1.200/33', '256.1.1.1/24', '192.168.1/24',
      '192.168.1.200/24/1', 'fe80::1/64', 'auto', '192.168.1.200 /24', '1.2.3.4/-1', null, undefined])
      expect(valid_south_addr(bad), String(bad)).toBe(false)
  })
})

describe('validating the form', () => {
  const good = () => ({ ...new_approve_form('fplus'), north: A, south: B, addr: '192.168.1.200/24', disk: '/dev/nvme0n1' })

  it('passes a complete form', () => {
    expect(validate_approve(good())).toEqual({})
  })

  it('asks for each choice that is missing', () => {
    expect(validate_approve(new_approve_form())).toEqual({
      north: 'Choose which port is northbound.',
      south: 'Choose the southbound port, or choose No southbound port.',
      disk: 'Choose the disk to install on.',
      admin: 'Start with a lowercase letter, then use lowercase letters, digits, - or _. At most 31 characters.',
    })
  })

  it('needs an address only when there is a southbound port', () => {
    expect(validate_approve({ ...good(), addr: '' })).toEqual({
      addr: 'Enter an address with a prefix length, such as 192.168.1.200/24, or the word dhcp.',
    })
    expect(validate_approve({ ...good(), south: '', addr: '' })).toEqual({})
  })

  it('checks the admin username', () => {
    for (const ok of ['fplus', 'a', 'cell-1_x', 'a'.repeat(31)]) expect(valid_admin_user(ok), ok).toBe(true)
    for (const bad of ['', 'Fplus', '1abc', 'has space', 'a'.repeat(32), 'root!']) expect(valid_admin_user(bad), bad).toBe(false)
  })

  it('checks each SSH key line, and allows none', () => {
    expect(valid_ssh_keys('')).toBe(true)
    expect(valid_ssh_keys('ssh-ed25519 AAAAC3Nz alice@laptop\n\necdsa-sha2-nistp256 AAAAE2Vj\n')).toBe(true)
    expect(valid_ssh_keys('sk-ssh-ed25519@openssh.com AAAAGnNr')).toBe(true)
    expect(valid_ssh_keys('ssh-ed25519 AAAAC3Nz\n-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(false)
    expect(validate_approve({ ...good(), keys: 'not a key' })).toEqual({
      keys: 'One of these lines is not an SSH public key. A public key starts with ssh-, ecdsa- or sk-.',
    })
  })
})

describe('what approving sends', () => {
  it('sends the choices as the service takes them', () => {
    const form = { ...new_approve_form('fplus'), north: A, south: B, addr: ' DHCP ', disk: '/dev/nvme0n1', admin: ' fplus ', note: ' tapeline ', keys: 'ssh-ed25519 AAAA' }
    expect(approve_body(form)).toEqual({
      north_mac: A, south_mac: B, south_addr: 'dhcp', disk: '/dev/nvme0n1',
      admin_user: 'fplus', label: 'tapeline', ssh_keys: 'ssh-ed25519 AAAA',
    })
  })

  it('sends no southbound address for a gateway with one network', () => {
    const form = { ...new_approve_form('fplus'), north: A, south: '', addr: '192.168.1.200/24', disk: '/dev/nvme0n1' }
    expect(approve_body(form)).toMatchObject({ south_mac: '', south_addr: '' })
  })

  it('spells out the disk that will be erased before it asks', () => {
    const gw = pending([nic('enp1s0', A), nic('enp2s0', B)])
    const form = { ...new_approve_form('fplus'), north: A, south: B, addr: '192.168.1.200/24', disk: '/dev/nvme0n1' }
    expect(erase_lines(form, gw)).toEqual([
      { text: 'Gateway: serial PF550F40' },
      { text: 'Disk to erase: /dev/nvme0n1 · 256 GB · SAMSUNG MZVLB256', strong: true },
      { text: 'Northbound: enp1s0 · ' + A },
      { text: 'Southbound: enp2s0 · ' + B + ', address 192.168.1.200/24' },
      { text: 'The install erases everything on the disk. This cannot be undone.' },
    ])
    const old = { id: 'old', report: { hostname: 'fpcgw-old' }, settings: { label: 'tapeline' } }
    const lines = erase_lines({ ...form, south: '', keepName: true }, gw, old).map(l => l.text)
    expect(lines).toContain('Southbound: none')
    expect(lines).toContain('Replaces: fpcgw-old · tapeline, keeping its hostname')
  })
})
