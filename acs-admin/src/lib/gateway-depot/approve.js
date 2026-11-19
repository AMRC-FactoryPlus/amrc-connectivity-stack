/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The approval form: starting choices, validation and the request body.
 * Pure functions, so the form component only holds what a person typed. */

import { clean, disk_size, disks_of, hardware_of, host_of, is_usb, label_for, link_text, nics_of, serial_of, transport_name } from './model.js'

/* The value of "No, this is a new gateway" in the replace menu. */
export const NEW_GATEWAY = 'new'

/**
 * A new form. `north`, `south` and `disk` are null until chosen; an
 * empty `south` means no southbound port. `touched` records what the
 * person chose for themselves, so the starting choices stop following
 * the live ports for those fields.
 */
export function new_approve_form (admin_user = '') {
  return { north: null, south: null, disk: null, addr: '', admin: clean(admin_user), note: '', keys: '', replaces: '', keepName: true, touched: {} }
}

/** The northbound guess: the port with an address, or the only port. */
export function suggest_north (nics) {
  const n = nics.find(x => clean(x.ipv4)) || (nics.length === 1 ? nics[0] : null)
  return n ? n.mac : null
}

/** The disk guess: the largest disk that is not a USB disk. */
export function suggest_disk (disks) {
  const pool = disks.filter(d => !is_usb(d))
  const from = pool.length ? pool : disks
  return from.reduce((best, d) => (!best || Number(d.size) > Number(best.size) ? d : best), null)
}

export const disk_line = d => (d ? [clean(d.path), disk_size(d.size), clean(d.model)].filter(Boolean).join(' · ') : '')
export const port_detail = n => [link_text(n), clean(n.ipv4)].filter(Boolean).join(' · ')

/**
 * Work out what the form should show for a gateway as it is now.
 * Starting choices follow the old gateway's port names when this one
 * replaces another, or else the live ports, until the person chooses
 * for themselves. A choice whose port or disk has gone is dropped.
 *
 * @param form  the form state (not changed)
 * @param gw    the gateway waiting for approval
 * @param old   the gateway it replaces, or null
 * @returns { north, south, disk, nics, disks, north_options,
 *  south_options, disk_options } where the first three are the values
 *  the form should now hold.
 */
export function approve_view (form, gw, old = null) {
  const nics = nics_of(gw).filter(n => clean(n.mac))
  const disks = disks_of(gw).filter(d => clean(d.path))
  const touched = form.touched || {}
  let { north, south, disk } = form

  const guess = old && old.report ? { north: clean(old.report.north), south: clean(old.report.south) } : null
  const gn = guess && guess.north ? nics.find(n => clean(n.name) === guess.north) : null
  const sn = gn ? gn.mac : suggest_north(nics)
  if (!touched.north && sn) north = sn
  if (north && !nics.some(n => n.mac === north)) north = null
  if (!touched.south) {
    const gs = gn && guess.south ? nics.find(n => clean(n.name) === guess.south && n.mac !== north) : null
    if (nics.length <= 1) south = ''
    else if (gs) south = gs.mac
    else if (gn && !guess.south) south = ''
    else if (nics.length === 2 && north) south = nics.find(n => n.mac !== north).mac
    else if (south === north) south = null
  }
  if (south && !nics.some(n => n.mac === south)) south = null
  /* A port cannot be both, whoever chose it. */
  if (south && south === north) south = null
  const sd = suggest_disk(disks)
  if (!touched.disk && sd) disk = sd.path
  if (disk && !disks.some(d => d.path === disk)) disk = null

  const north_options = nics.map(n => ({
    value: n.mac,
    title: clean(n.name) || n.mac,
    detail: port_detail(n),
    hint: n.mac !== sn ? '' : gn ? 'Suggested' : clean(n.ipv4) ? 'Suggested' : 'The only port',
  }))
  const south_options = nics.map(n => ({
    value: n.mac,
    title: clean(n.name) || n.mac,
    detail: n.mac === north ? 'Already chosen as the northbound port' : port_detail(n),
    disabled: n.mac === north,
  })).concat([{
    value: '',
    title: 'No southbound port',
    detail: nics.length <= 1 ? 'This gateway has one port.' : 'Use this gateway without a machine network.',
  }])
  const disk_options = disks.map(d => ({
    value: d.path,
    title: clean(d.path),
    mono: true,
    detail: [disk_size(d.size), clean(d.model), transport_name(d.transport), disks.length > 1 && clean(d.serial) ? 'serial ' + clean(d.serial) : ''].filter(Boolean).join(' · '),
    hint: is_usb(d) ? 'This may be the depot USB stick' : disks.length === 1 ? 'The only disk' : sd && d.path === sd.path ? 'Suggested' : '',
  }))

  return { north, south, disk, nics, disks, north_options, south_options, disk_options }
}

/**
 * The southbound port to hold after a person chooses `mac` as
 * northbound: a port cannot be both.
 */
export function south_after_north (south, mac, nics) {
  if (south !== mac) return south
  const others = nics.filter(n => n.mac !== mac)
  return others.length === 1 ? others[0].mac : null
}

/**
 * The fields to start from when this gateway replaces `old`: the old
 * gateway's settings, for the fields the person has not typed in.
 */
export function old_choices (form, old) {
  const os = (old && old.settings) || {}
  const touched = form.touched || {}
  const out = {}
  if (!touched.addr && clean(os.south_addr)) out.addr = clean(os.south_addr)
  if (!touched.admin && clean(os.admin_user)) out.admin = clean(os.admin_user)
  if (!touched.note && clean(os.label)) out.note = clean(os.label)
  return out
}

/* ---------- validation ---------- */

const is_dhcp = addr => /^dhcp$/i.test(clean(addr))

/** True for an IPv4 address with a prefix length, or the word dhcp. */
export function valid_south_addr (addr) {
  addr = clean(addr)
  if (is_dhcp(addr)) return true
  const cidr = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(addr)
  return !!cidr && cidr.slice(1, 5).every(o => Number(o) <= 255) && Number(cidr[5]) <= 32
}

/** The southbound address as the service takes it. */
export const south_addr_value = addr => (is_dhcp(addr) ? 'dhcp' : clean(addr))

export const valid_admin_user = name => /^[a-z][a-z0-9_-]{0,30}$/.test(clean(name))

/** True when every line that is not blank looks like an SSH public key. */
export function valid_ssh_keys (keys) {
  return !String(keys ?? '').split('\n').map(l => l.trim()).filter(Boolean).some(k => !/^(ssh-|ecdsa-|sk-)\S+ \S+/.test(k))
}

/**
 * Check the form. Returns the problems by field, in the order the form
 * shows the fields: { north, south, addr, disk, admin, keys }, each a
 * message. An empty object means the form can be sent.
 */
export function validate_approve (form) {
  const e = {}
  if (!form.north) e.north = 'Choose which port is northbound.'
  if (form.south === null || form.south === undefined) e.south = 'Choose the southbound port, or choose No southbound port.'
  if (form.south && !valid_south_addr(form.addr)) e.addr = 'Enter an address with a prefix length, such as 192.168.1.200/24, or the word dhcp.'
  if (!form.disk) e.disk = 'Choose the disk to install on.'
  if (!valid_admin_user(form.admin)) e.admin = 'Start with a lowercase letter, then use lowercase letters, digits, - or _. At most 31 characters.'
  if (!valid_ssh_keys(form.keys)) e.keys = 'One of these lines is not an SSH public key. A public key starts with ssh-, ecdsa- or sk-.'
  return e
}

/** The body of the approve request. `old` is the gateway replaced, or null. */
export function approve_body (form, old = null) {
  const body = {
    north_mac: form.north,
    south_mac: form.south || '',
    south_addr: form.south ? south_addr_value(form.addr) : '',
    disk: form.disk,
    admin_user: clean(form.admin),
    label: clean(form.note),
    ssh_keys: form.keys,
  }
  if (old) { body.replaces = old.id; body.keep_hostname = !!form.keepName }
  return body
}

/**
 * The lines of the erase confirmation: [{ text, strong }].
 */
export function erase_lines (form, gw, old = null) {
  const nics = nics_of(gw)
  const d = disks_of(gw).find(x => x.path === form.disk)
  const pn = mac => { const n = nics.find(x => x.mac === mac); return n ? (clean(n.name) ? clean(n.name) + ' · ' : '') + n.mac : '' }
  return [
    { text: 'Gateway: ' + (serial_of(gw) ? 'serial ' + serial_of(gw) : hardware_of(gw) || 'no serial number') },
    { text: 'Disk to erase: ' + disk_line(d), strong: true },
    { text: 'Northbound: ' + pn(form.north) },
    { text: 'Southbound: ' + (form.south ? pn(form.south) + ', address ' + south_addr_value(form.addr) : 'none') },
    old ? { text: 'Replaces: ' + label_for(old) + (form.keepName ? ', keeping its hostname' : ', with a new hostname') } : null,
    { text: 'The install erases everything on the disk. This cannot be undone.' },
  ].filter(Boolean)
}

/** What the replace box says about the hostname. */
export function keep_name_text (old) {
  const oh = host_of(old)
  return oh ? 'Keep the hostname ' + oh : 'Keep the old gateway’s hostname'
}
