/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Reading a gateway as the Gateway Depot service returns it. Everything
 * here is a pure function of its arguments, so the pages and the unit
 * tests share it. Every string from the service is untrusted text. */

export const clean = v => (v == null ? '' : String(v).trim())
export const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's')

/* ---------- times and sizes ---------- */

export function dur (ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'less than a minute'
  const m = Math.floor(s / 60)
  if (m < 60) return plural(m, 'minute')
  const hr = Math.floor(m / 60)
  if (hr < 48) return plural(hr, 'hour')
  return plural(Math.floor(hr / 24), 'day')
}

/** How long ago `ms` was, as of `now`. Empty when there is no time. */
export const ago = (ms, now = Date.now()) => (ms ? dur(now - ms) + ' ago' : '')

/** A time of day, with the date when it is not today. */
export function clock (ms, now = Date.now()) {
  if (!ms) return ''
  const d = new Date(ms)
  const same_day = d.toDateString() === new Date(now).toDateString()
  return same_day ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function disk_size (bytes) {
  const n = Number(bytes)
  if (!n || n < 0) return ''
  if (n >= 1e12) return (n / 1e12).toFixed(n >= 1e13 ? 0 : 1).replace(/\.0$/, '') + ' TB'
  if (n >= 1e9) return Math.round(n / 1e9) + ' GB'
  return Math.max(1, Math.round(n / 1e6)) + ' MB'
}

export function mem_size (bytes) {
  const n = Number(bytes)
  if (!n || n < 0) return ''
  return (n / 1073741824).toFixed(1).replace(/\.0$/, '') + ' GB memory'
}

const TRANSPORT = { nvme: 'NVMe', sata: 'SATA', usb: 'USB', sas: 'SAS', mmc: 'eMMC', virtio: 'virtual disk', scsi: 'SCSI', ata: 'ATA' }
export const transport_name = t => TRANSPORT[clean(t).toLowerCase()] || clean(t)
export const is_usb = d => clean(d?.transport).toLowerCase() === 'usb'
export const show_ip = ip => clean(ip).replace(/^::ffff:/i, '')

/* ---------- reading a gateway ---------- */

/* What firmware reports when the maker never filled a field in. */
const PLACEHOLDERS = new Set(['', 'default string', 'to be filled by o.e.m.', 'to be filled by oem', 'system serial number',
  'system manufacturer', 'system product name', 'none', 'not specified', 'not applicable', 'n/a', 'na', 'unknown',
  'invalid', '0', '00000000', '0123456789', '123456789', 'chassis serial number', 'oem'])
export const real = v => { const s = clean(v); return PLACEHOLDERS.has(s.toLowerCase()) ? '' : s }

const inv = gw => gw?.inventory || {}
export const serial_of = gw => real(inv(gw).serial)
export const hardware_of = gw => [real(inv(gw).vendor), real(inv(gw).model)].filter(Boolean).join(' ')
export const host_of = gw => clean(gw?.report && gw.report.hostname)
export const note_of = gw => clean(gw?.settings && gw.settings.label)
export const name_of = gw => host_of(gw) || note_of(gw) || hardware_of(gw) || 'Unidentified gateway'
export const nics_of = gw => (Array.isArray(inv(gw).nics) ? inv(gw).nics.filter(Boolean) : [])
export const first_mac = gw => clean((nics_of(gw).find(n => clean(n.mac)) || {}).mac)
export const disks_of = gw => (Array.isArray(inv(gw).disks) ? inv(gw).disks.filter(Boolean) : [])
export const report_nics = gw => (gw?.report && Array.isArray(gw.report.nics) ? gw.report.nics.filter(Boolean) : [])

/** A gateway's name, with its note when the name is its hostname. */
export const label_for = gw => name_of(gw) + (host_of(gw) && note_of(gw) ? ' · ' + note_of(gw) : '')

export function cluster_name (gw) {
  const c = (gw && gw.onboard && gw.onboard.cluster) || {}
  return clean(c.name) || clean(c.name_given)
}

/** The facts under the serial number while a gateway waits for approval. */
export function facts_of (gw, now = Date.now()) {
  const i = inv(gw)
  return [hardware_of(gw), clean(i.arch), i.cpus ? plural(Number(i.cpus), 'CPU') : '', mem_size(i.memory),
    gw.first_seen ? 'appeared ' + ago(gw.first_seen, now) : ''].filter(Boolean).join(' · ')
}

/* ---------- states ---------- */

/* The list is grouped by what needs a person. */
export const GROUPS = [['needs', 'Needs you'], ['working', 'Working...'], ['service', 'In service'], ['retired', 'Out of service']]

/**
 * Where a gateway sits in the list, how its status is coloured, and the
 * state word shown for it.
 */
export function state_meta (gw) {
  switch (gw.state) {
    case 'pending':    return { group: 'needs',   tone: 'action', label: 'Waiting for approval' }
    case 'approved':   return { group: 'working', tone: 'busy',   label: 'Approved' }
    case 'installing': return { group: 'working', tone: 'busy',   label: 'Installing' }
    case 'installed':  return { group: 'needs',   tone: 'action', label: 'Installed' }
    case 'ready':      return { group: 'needs',   tone: 'action', label: 'Ready to onboard' }
    case 'onboarding': return { group: 'working', tone: 'busy',   label: 'Onboarding' }
    case 'onboarded':  return { group: 'service', tone: 'ok',     label: 'In service' }
    case 'failed':     return { group: 'needs',   tone: 'bad',    label: gw.install_failed ? 'Install failed' : 'Onboarding failed' }
    case 'replaced':   return { group: 'retired', tone: 'off',    label: 'Replaced' }
    default:           return { group: 'retired', tone: 'off',    label: 'State: ' + clean(gw.state) }
  }
}

/** Which body the gateway's page shows. */
export function kind_of (gw) {
  switch (gw.state) {
    case 'pending': return 'pending'
    case 'approved': case 'installing': return 'installing'
    case 'installed': return 'installed'
    case 'ready': return 'ready'
    case 'onboarding': return 'onboarding'
    case 'onboarded': return 'onboarded'
    case 'failed': return gw.install_failed ? 'failed-install' : 'failed-onboard'
    case 'replaced': return 'replaced'
    default: return 'other'
  }
}

/* States in which being out of contact is expected. */
const QUIET = new Set(['approved', 'installing', 'installed', 'replaced'])

/** True when a gateway that should be calling in is not. */
export const is_lost = gw => !gw.online && !QUIET.has(gw.state) && !gw.install_failed

/**
 * The gateways in each group, in the order the service lists them, with
 * how many of those in service are not in contact.
 *
 * @returns [{ key, label, gateways, quiet, count }] for the groups that
 *  have gateways. `count` is the text after the group's name.
 */
export function group_gateways (gateways) {
  const by = { needs: [], working: [], service: [], retired: [] }
  for (const gw of gateways ?? []) by[state_meta(gw).group].push(gw)
  return GROUPS
    .map(([key, label]) => {
      const list = by[key]
      const quiet = key === 'service' ? list.filter(gw => !gw.online).length : 0
      return { key, label, gateways: list, quiet, count: list.length + (quiet ? ', ' + quiet + ' not in contact' : '') }
    })
    .filter(g => g.gateways.length)
}

/** One row of the list. */
export function row_of (gw, now = Date.now()) {
  const m = state_meta(gw)
  const host = host_of(gw)
  const lost = is_lost(gw)
  return {
    id: gw.id,
    name: name_of(gw),
    second: host ? note_of(gw) : serial_of(gw) || first_mac(gw),
    second_mono: !host,
    hardware: hardware_of(gw),
    serial: serial_of(gw),
    label: m.label,
    tone: lost && gw.state === 'onboarded' ? 'off' : m.tone,
    bad: m.tone === 'bad',
    lost,
    contact: lost ? 'Not in contact' + (gw.last_seen ? ', last seen ' + ago(gw.last_seen, now) : '') : '',
  }
}

/** Whether the gateway is in contact, in words, and whether to warn. */
export function contact_of (gw, now = Date.now()) {
  const ip = show_ip(gw.remote_ip)
  const seen = gw.last_seen ? ago(gw.last_seen, now) : ''
  if (gw.online) return { tone: 'ok', warn: false, text: 'In contact' + (ip ? ' · calling from ' + ip : '') }
  if (gw.state === 'approved' || gw.state === 'installing' || gw.state === 'installed')
    return { tone: 'off', warn: false, text: 'Not in contact' }
  if (gw.state === 'replaced') return { tone: 'off', warn: false, text: 'Out of service' + (seen ? '. Last seen ' + seen : '') }
  if (gw.install_failed) return { tone: 'off', warn: false, text: 'Not in contact' + (seen ? '. Last seen ' + seen : '') }
  return { tone: 'off', warn: true, text: 'Not in contact' + (seen ? '. Last seen ' + seen + (ip ? ' at ' + ip : '') : '') }
}

/** The line under a gateway's name. */
export function subline_of (gw) {
  const host = host_of(gw), note = note_of(gw), hw = hardware_of(gw), serial = serial_of(gw)
  const parts = []
  if (host && note) parts.push(note)
  if (hw && (host || note)) parts.push(hw)
  parts.push(serial ? 'serial ' + serial : 'no serial number reported' + (first_mac(gw) ? ' · first port ' + first_mac(gw) : ''))
  return parts.join(' · ')
}

/**
 * How a gateway relates to another one: { pre, id, post } to build
 * "Replaced by <link>." from, or null.
 */
export function relation_of (gw, gateways) {
  if (gw.replaced_by) return { pre: 'Replaced by ', id: gw.replaced_by, post: '' }
  if (gw.replaces) {
    return {
      pre: gw.state === 'onboarded' ? 'Replaced ' : 'Replaces ',
      id: gw.replaces,
      post: clean(gw.settings && gw.settings.hostname) ? ', keeping its hostname' : ', with a new hostname',
    }
  }
  const by = (gateways ?? []).find(x => x.replaces === gw.id)
  return by ? { pre: 'Being replaced by ', id: by.id, post: '' } : null
}

/* ---------- the five steps ---------- */

export const STEP_TITLES = [null, 'Approve', 'Install', 'Install the gateway at the edge', 'Onboard', 'In service']
const STEP_TODO = [null, '', '', 'needs you', 'needs you', '']
export const STEP_HINT = [null, '',
  'The gateway installs its operating system',
  'The gateway powers off, you remove the USB stick, install the gateway at the edge, and power it on.',
  'Once the gateway is powered on at the edge this page onboards it.',
  'Factory+ confirms it can see the gateway.']
const CURRENT = { pending: 1, installing: 2, 'failed-install': 2, installed: 3, ready: 4, onboarding: 4, 'failed-onboard': 4, onboarded: 5 }
const NEEDS_YOU = new Set(['pending', 'installed', 'ready'])
/* When each step finished. The last step has no end. */
const STEP_AT = [null, 'approved_at', 'installed_at', 'ready_at', 'onboarded_at', null]

/* The five steps as the overview lists them. */
export const HOW = [
  ['Approve.', 'Configure the gateway'],
  ['Install.', 'The gateway installs its operating system'],
  ['Install the gateway at the edge.', 'The gateway powers off, you remove the USB stick, install the gateway at the edge, and power it on.'],
  ['Onboard.', 'Once the gateway is powered on at the edge this page onboards it.'],
  ['In service.', 'Factory+ confirms it can see the gateway.'],
]

/**
 * The five steps for a gateway: [{ n, title, status, tag, hint, at }].
 * `status` is done, current, failed or todo. `at` is when a finished
 * step finished, if the service recorded it. Empty for a gateway that
 * has been replaced or is in a state this page does not know.
 */
export function steps_of (gw) {
  const kind = kind_of(gw)
  const cur = CURRENT[kind]
  if (!cur) return []
  const failed = kind === 'failed-install' || kind === 'failed-onboard'
  const out = []
  for (let n = 1; n <= 5; n++) {
    const status = kind === 'onboarded' || n < cur ? 'done' : n === cur ? (failed ? 'failed' : 'current') : 'todo'
    const tag = status === 'current' ? (NEEDS_YOU.has(kind) ? 'needs you now' : 'working...')
      : status === 'failed' ? 'failed' : status === 'done' ? 'done' : STEP_TODO[n]
    out.push({
      n, status, tag,
      title: STEP_TITLES[n],
      hint: STEP_HINT[n],
      at: status === 'done' && STEP_AT[n] ? gw[STEP_AT[n]] ?? null : null,
    })
  }
  return out
}

/* ---------- ports ---------- */

export const speed_text = n => { const s = Number(n.speed); return s > 0 ? s + ' Mb/s' : '' }
export const link_text = n => (n.link ? ['Cable plugged in', speed_text(n)].filter(Boolean).join(' · ') : 'No cable')

/**
 * The ports as the installed gateway set them up. Falls back to what
 * was chosen at approval.
 *
 * @returns { nics, role } where role(nic) is Northbound, Southbound or
 *  Not used.
 */
export function configured_ports (gw) {
  const r = gw.report || {}, s = gw.settings || {}
  const nics = report_nics(gw).length ? report_nics(gw) : nics_of(gw)
  const role = n => {
    if (r.north || r.south) return n.name === r.north ? 'Northbound' : n.name && n.name === r.south ? 'Southbound' : 'Not used'
    const mac = clean(n.mac).toLowerCase()
    return mac && mac === clean(s.north_mac).toLowerCase() ? 'Northbound'
      : mac && mac === clean(s.south_mac).toLowerCase() ? 'Southbound' : 'Not used'
  }
  return { nics, role }
}

/** A port chosen at approval, as "name<sep>mac", from its MAC address. */
export function settings_port (gw, mac, sep = ' · ', prefix = '') {
  mac = clean(mac).toLowerCase()
  if (!mac) return ''
  const n = nics_of(gw).find(x => clean(x.mac).toLowerCase() === mac)
  return (n && clean(n.name) ? clean(n.name) + sep : '') + prefix + mac
}

/** The settings chosen at approval, as rows of [label, value]. */
export function settings_rows (gw) {
  const s = gw.settings || {}
  const rows = [
    ['Northbound port', settings_port(gw, s.north_mac) || 'Not recorded'],
    ['Southbound port', settings_port(gw, s.south_mac) || 'None'],
  ]
  if (clean(s.south_mac)) rows.push(['Southbound address', clean(s.south_addr)])
  rows.push(['Disk', clean(s.disk)], ['Admin user', clean(s.admin_user)])
  if (clean(s.label)) rows.push(['Note', clean(s.label)])
  return rows
}

/**
 * Note which cables and addresses changed since the last look, so a
 * person can find a port by plugging a cable in.
 *
 * @param links  Map of "id|mac" -> { link, ip, ev }, updated in place
 * @returns the changes seen this time: [{ id, port, text }]
 */
export function track_links (links, gateways, now = Date.now()) {
  const keep = new Set()
  const changes = []
  for (const gw of gateways ?? []) {
    const nics = gw.state === 'pending' ? nics_of(gw) : report_nics(gw)
    for (const n of nics) {
      const key = link_key(gw.id, n)
      keep.add(key)
      const cur = { link: !!n.link, ip: clean(n.ipv4) }
      const prev = links.get(key)
      let ev = prev ? prev.ev : null
      if (prev && prev.link !== cur.link) ev = { text: cur.link ? 'Cable plugged in a moment ago' : 'Cable unplugged a moment ago', at: now }
      else if (prev && prev.ip !== cur.ip) ev = { text: cur.ip ? 'Address changed a moment ago' : 'Address lost a moment ago', at: now }
      if (ev && ev !== (prev && prev.ev)) changes.push({ id: gw.id, port: clean(n.name), text: ev.text })
      links.set(key, { link: cur.link, ip: cur.ip, ev })
    }
  }
  for (const k of links.keys()) if (!keep.has(k)) links.delete(k)
  return changes
}

export const link_key = (id, n) => id + '|' + (n.mac || n.name)

/* ---------- step 4 and 5 in words ---------- */

/** What onboarding did, once it has finished. */
export function onboarded_text (gw, by_id, now = Date.now()) {
  const o = gw.onboard || {}
  const server = o.server ? by_id.get(o.server) : null
  const what = o.mode === 'join' ? (server ? 'Joined the cluster of ' + label_for(server) : 'Joined an existing cluster')
    : gw.replaces ? 'Took over the cluster of the gateway it replaced' : 'Created a new edge cluster'
  return what + (o.by ? '. Started by ' + clean(o.by) + (o.started ? ', ' + clock(o.started, now) : '') : '') + '.'
}

/** The cluster of a gateway in service, in words. */
export function service_cluster_text (gw, by_id) {
  const o = gw.onboard || {}, c = o.cluster || {}
  const name = clean(c.name), given = clean(c.name_given)
  const server = o.server ? by_id.get(o.server) : null
  return (name ? name + (given && given !== name ? ' (entered as ' + given + ')' : '') : given || (o.mode === 'join' ? 'An existing cluster' : ''))
    + (o.server ? ', joined through ' + (server ? label_for(server) : 'a gateway that is no longer in the list') : '')
}

/* ---------- replacing ---------- */

/** True when a new gateway may take over from this one. */
export function can_be_replaced (gw, for_id) {
  const o = gw.onboard || {}
  return gw.id !== for_id && (gw.state === 'onboarded' || gw.state === 'failed') && !gw.install_failed
    && o.mode === 'create' && !!(o.cluster && o.cluster.uuid) && !gw.replaced_by
}

/** The gateways `for_id` could replace, those not in contact first. */
export function replace_candidates (gateways, for_id) {
  return (gateways ?? []).filter(x => can_be_replaced(x, for_id))
    .sort((a, z) => (a.online === z.online ? 0 : a.online ? 1 : -1))
}

/** The name the admin login is listed under after approval. */
export function secret_name (gw, note) {
  return [clean(note), serial_of(gw) ? 'serial ' + serial_of(gw) : hardware_of(gw)].filter(Boolean).join(', ') || 'this gateway'
}
