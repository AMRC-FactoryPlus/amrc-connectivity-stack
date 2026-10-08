/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Pure functions for the Datasets pages. Nothing here talks to a
 * service, so all of it is unit-tested in test/datasets-model.test.js.
 */

import { DA, STRUCTURE, KINDS } from './constants.js'

export const TZ = 'Europe/London'

/* ------------------------------------------------------------------
 * Merging what Data Access returns
 * ------------------------------------------------------------------ */

/**
 * Merge the two Data Access searches into one record per dataset.
 *
 * `metadata` comes from search_metadata (datasets you can read, valid
 * ones only). `structures` comes from search_structure (datasets you can
 * edit, including invalid ones). Either may be missing a dataset the
 * other has.
 *
 * @returns {Object<string, DatasetRecord>} keyed by UUID
 */
export function merge_datasets (metadata = [], structures = []) {
    const out = {}
    for (const m of metadata) {
        if (!m?.uuid) continue
        out[m.uuid] = base_record(m.uuid)
        Object.assign(out[m.uuid], {
            name:      m.name && m.name !== 'UNKNOWN' ? m.name : null,
            from:      m.from ?? null,
            to:        m.to ?? null,
            functions: m.function ?? [],
            meta:      m.metadata ?? {},
            parts:     m.parts ?? [],
            readable:  true,
        })
    }
    for (const s of structures) {
        if (!s?.uuid) continue
        const r = out[s.uuid] ?? (out[s.uuid] = base_record(s.uuid))
        r.structure = s.structure ?? null
        r.config = s.config ?? null
        r.editable = true
        r.invalid = s.structure === STRUCTURE.INVALID
    }
    for (const r of Object.values(out)) decorate(r)
    return out
}

function base_record (uuid) {
    return {
        uuid,
        name: null,
        from: null,
        to: null,
        functions: [],
        meta: {},
        parts: [],
        structure: null,
        config: null,
        readable: false,
        editable: false,
        invalid: false,
    }
}

// Pull the Admin UI's own metadata apps out into named fields.
function decorate (r) {
    const meta = r.meta ?? {}
    r.tags = normalise_tags(meta[DA.App.Tags]?.tags)
    r.labels = meta[DA.App.EquipmentLabels]?.labels ?? {}
    r.run = meta[DA.App.RunMetadata] ?? null
    r.recording = meta[DA.App.Recording] ?? null
    r.kind = dataset_kind(r)
    r.created_by = r.run?.createdBy ?? null
    r.created_via = r.run?.createdVia ?? null
    r.voided = !!r.run?.void
    r.reference = r.run?.reference ?? null
}

export function normalise_tags (tags) {
    if (!Array.isArray(tags)) return []
    const seen = new Set()
    const out = []
    for (const t of tags) {
        if (typeof t !== 'string') continue
        const v = t.trim()
        if (!v || seen.has(v.toLowerCase())) continue
        seen.add(v.toLowerCase())
        out.push(v)
    }
    return out
}

/**
 * The kind of a dataset, from its functional classes, or 'device' for
 * a bare Sparkplug source, or 'other'.
 */
export function dataset_kind (r) {
    const fns = r.functions ?? []
    for (const k of KINDS) {
        if (fns.includes(k.klass)) return k.id
    }
    if (r.structure === STRUCTURE.DEVICE) return 'device'
    return 'other'
}

export function display_name (r) {
    if (!r) return 'Unknown dataset'
    return r.name ?? `Unnamed ${r.uuid.slice(0, 8)}`
}

/* ------------------------------------------------------------------
 * Structure: what a dataset is made of, and what includes it
 * ------------------------------------------------------------------ */

/** The datasets a dataset is built from, one level down. */
export function direct_sources (r) {
    if (!r?.config) return []
    if (r.structure === STRUCTURE.UNION && Array.isArray(r.config)) return r.config.filter(Boolean)
    if (r.structure === STRUCTURE.SESSION && r.config.source) return [r.config.source]
    return []
}

/**
 * Datasets that include this one directly, worked out from the
 * structures you can see. Data Access also refuses a delete with the
 * full list (HTTP 409), which covers ones you cannot see.
 */
export function included_in (uuid, byUuid) {
    const out = []
    for (const r of Object.values(byUuid)) {
        if (direct_sources(r).includes(uuid)) out.push(r.uuid)
    }
    return out
}

/**
 * Resolve a dataset to the devices it covers, through unions and
 * sessions. Returns device UUIDs and the device datasets that hold them.
 * Datasets you cannot see the structure of are listed in `unknown`.
 */
export function resolve_devices (uuid, byUuid) {
    const devices = new Set()
    const device_datasets = new Set()
    const unknown = new Set()
    const seen = new Set()
    const walk = id => {
        if (seen.has(id)) return
        seen.add(id)
        const r = byUuid[id]
        if (!r || !r.structure || r.invalid) { unknown.add(id); return }
        if (r.structure === STRUCTURE.DEVICE) {
            if (r.config?.source) devices.add(r.config.source)
            device_datasets.add(id)
            return
        }
        for (const s of direct_sources(r)) walk(s)
    }
    walk(uuid)
    return {
        devices: [...devices],
        device_datasets: [...device_datasets],
        unknown: [...unknown],
    }
}

/** Find the device dataset (bare Sparkplug source) for a device. */
export function device_dataset_for (device_uuid, byUuid) {
    const found = Object.values(byUuid)
        .filter(r => r.structure === STRUCTURE.DEVICE && r.config?.source === device_uuid)
        // Prefer a named one, then the oldest-looking (stable) choice.
        .sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || a.uuid.localeCompare(b.uuid))
    return found[0]?.uuid ?? null
}

/**
 * Device datasets that two or more items of a union both reach. The CSV
 * then holds those rows twice, so the builder warns about it.
 */
export function overlapping_devices (items, byUuid) {
    const count = new Map()
    for (const id of items) {
        for (const d of resolve_devices(id, byUuid).device_datasets) {
            count.set(d, (count.get(d) ?? 0) + 1)
        }
    }
    return [...count].filter(([, n]) => n > 1).map(([d]) => d)
}

/**
 * The structure tree of a dataset, for the Structure tab.
 * Each node: { uuid, structure, depth, label, children }.
 */
export function structure_tree (uuid, byUuid, seen = new Set(), depth = 0) {
    const r = byUuid[uuid]
    const node = { uuid, depth, record: r ?? null, structure: r?.structure ?? null, children: [], cycle: false }
    if (seen.has(uuid)) { node.cycle = true; return node }
    seen = new Set(seen).add(uuid)
    node.children = direct_sources(r).map(s => structure_tree(s, byUuid, seen, depth + 1))
    return node
}

/* ------------------------------------------------------------------
 * Status
 * ------------------------------------------------------------------ */

/**
 * One status per dataset for lists and headers.
 *   recording | voided | invalid | filling | none
 * `filling` means the window ends in the future.
 */
export function dataset_status (r, now = Date.now()) {
    if (r.invalid) return 'invalid'
    if (r.kind === 'equipment' && r.recording?.startedAt) return 'recording'
    if (r.voided) return 'voided'
    if (r.to && Date.parse(r.to) > now) return 'filling'
    return 'none'
}

/* ------------------------------------------------------------------
 * Time
 * ------------------------------------------------------------------ */

/** The exact UTC form Data Access accepts: YYYY-MM-DDTHH:mm:ss.sssZ. */
export function to_iso (t) {
    const d = t instanceof Date ? t : new Date(t)
    if (Number.isNaN(d.getTime())) throw new Error(`Not a time: ${t}`)
    return d.toISOString()
}

/** Check a window before it goes to the service, which accepts a bad one. */
export function validate_window (from, to) {
    if (from == null || to == null || from === '' || to === '') return 'Choose a start and an end.'
    const f = new Date(from).getTime(), t = new Date(to).getTime()
    if (Number.isNaN(f) || Number.isNaN(t)) return 'Enter a valid date and time.'
    if (f >= t) return 'The start must be before the end.'
    return null
}

const fmt_cache = new Map()
function fmt (opts) {
    const key = JSON.stringify(opts)
    if (!fmt_cache.has(key)) {
        fmt_cache.set(key, new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }))
    }
    return fmt_cache.get(key)
}

function parts_of (t, opts) {
    const o = {}
    for (const p of fmt(opts).formatToParts(new Date(t))) o[p.type] = p.value
    return o
}

/** "Wed 7 Oct, 09:12" in London time. Adds the year if not this year. */
export function fmt_time (t, now = Date.now()) {
    if (t == null) return '—'
    const p = parts_of(t, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const thisYear = parts_of(now, { year: 'numeric' }).year
    const y = p.year !== thisYear ? ` ${p.year}` : ''
    return `${p.weekday} ${p.day} ${p.month}${y}, ${p.hour}:${p.minute}`
}

/** "09:12" or "09:12:05" in London time. */
export function fmt_clock (t, seconds = false) {
    const p = parts_of(t, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    return seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`
}

/** "Wed 7 Oct" in London time. */
export function fmt_day (t) {
    const p = parts_of(t, { weekday: 'short', day: 'numeric', month: 'short' })
    return `${p.weekday} ${p.day} ${p.month}`
}

/** A window for people: same-day windows show the date once. */
export function fmt_window (from, to, now = Date.now()) {
    if (!from && !to) return 'Ongoing, no time window'
    if (!from) return `Until ${fmt_time(to, now)}`
    if (!to) return `From ${fmt_time(from, now)}`
    if (london_date_key(from) === london_date_key(to)) {
        return `${fmt_time(from, now)} – ${fmt_clock(to)}`
    }
    return `${fmt_time(from, now)} – ${fmt_time(to, now)}`
}

/** "2h 41m", "11h 45m", "3d 4h", "45s". */
export function fmt_duration (ms) {
    if (ms == null || Number.isNaN(ms)) return '—'
    const neg = ms < 0
    let s = Math.round(Math.abs(ms) / 1000)
    const d = Math.floor(s / 86400); s -= d * 86400
    const h = Math.floor(s / 3600); s -= h * 3600
    const m = Math.floor(s / 60); s -= m * 60
    let out
    if (d) out = `${d}d ${h}h`
    else if (h) out = `${h}h ${m}m`
    else if (m) out = `${m}m${s ? ` ${s}s` : ''}`
    else out = `${s}s`
    return neg ? `-${out}` : out
}

/** "00:17:22" for a running timer. */
export function fmt_elapsed (ms) {
    const s = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
}

/** YYYY-MM-DD of an instant in London. */
export function london_date_key (t) {
    const p = parts_of(t, { year: 'numeric', month: '2-digit', day: '2-digit' })
    return `${p.year}-${p.month}-${p.day}`
}

/** The UTC offset of London at an instant, in minutes (0 or 60). */
export function london_offset_min (t) {
    const p = parts_of(t, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
    return Math.round((asUtc - Math.floor(new Date(t).getTime() / 1000) * 1000) / 60000)
}

/**
 * Turn a London wall-clock value from <input type="datetime-local">
 * ("2026-10-07T09:12") into an instant (ms).
 */
export function london_local_to_ms (local) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(local ?? '')
    if (!m) return NaN
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
    // Correct by the offset at the guess, then once more near a change.
    let t = guess - london_offset_min(guess) * 60000
    t = guess - london_offset_min(t) * 60000
    return t
}

/** The reverse: an instant to "2026-10-07T09:12" in London. */
export function ms_to_london_local (t) {
    const p = parts_of(t, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** Midnight in London on the day of `t`, as ms. */
export function london_start_of_day (t) {
    return london_local_to_ms(`${london_date_key(t)}T00:00`)
}

/** Round ms to the nearest step (default 5 minutes). */
export function snap (ms, step = 5 * 60 * 1000) {
    return Math.round(ms / step) * step
}

/** Quick windows for the builder. Each returns { from, to } in ms. */
export function quick_window (id, now = Date.now()) {
    const today = london_start_of_day(now)
    switch (id) {
        case 'today':     return { from: today, to: london_local_to_ms(`${london_date_key(today + 36 * 3600e3)}T00:00`) - 1 }
        case 'yesterday': {
            const y = london_start_of_day(today - 12 * 3600e3)
            return { from: y, to: today - 1 }
        }
        case 'last24':    return { from: now - 24 * 3600e3, to: now }
        case 'last7':     return { from: now - 7 * 24 * 3600e3, to: now }
        default:          return null
    }
}

/* ------------------------------------------------------------------
 * Timeline geometry
 * ------------------------------------------------------------------ */

const HOUR = 3600e3
const DAY = 24 * HOUR

export const ZOOMS = {
    hours: { label: 'Hours', px_per_hour: 120,  span: 7 * DAY,       step: DAY },
    days:  { label: 'Days',  px_per_hour: 26,   span: 30 * DAY,      step: 7 * DAY },
    weeks: { label: 'Weeks', px_per_hour: 3,    span: 26 * 7 * DAY,  step: 28 * DAY },
    years: { label: 'Years', px_per_hour: 0.12, span: 2 * 365 * DAY, step: 91 * DAY },
}

/** The track's time range and scale around a centre time. */
export function track_range (zoom, centre) {
    const z = ZOOMS[zoom]
    const start = london_start_of_day(centre - z.span)
    const end = london_start_of_day(centre + z.span + DAY)
    const px_per_ms = z.px_per_hour / HOUR
    return { start, end, px_per_ms, width: Math.round((end - start) * px_per_ms) }
}

/**
 * Tick marks for a track. Each: { t, x, label, major }.
 * Hours: every hour, major at midnight. Days: every 6 h, major at
 * midnight. Weeks: every day, major on Mondays. Years: every month,
 * major in January.
 */
export function ticks (zoom, range) {
    const out = []
    const x = t => Math.round((t - range.start) * range.px_per_ms)
    if (zoom === 'hours' || zoom === 'days') {
        const every = zoom === 'hours' ? 1 : 6
        // Step through real hours (London is a whole number of hours from
        // UTC) and label each with the London clock. On a clock-change
        // day that gives 23 or 25 ticks, with 01:00 missing or repeated.
        for (let t = Math.ceil(range.start / HOUR) * HOUR; t < range.end; t += HOUR) {
            const p = parts_of(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
            const h = +p.hour
            if (h % every) continue
            out.push(h === 0
                ? { t, x: x(t), label: fmt_day(t), major: true }
                : { t, x: x(t), label: `${p.hour}:00`, major: false })
        }
    }
    else if (zoom === 'weeks') {
        for (let d = range.start; d < range.end; ) {
            const p = parts_of(d, { weekday: 'short', day: 'numeric', month: 'short' })
            const major = p.weekday === 'Mon'
            out.push({ t: d, x: x(d), label: major ? `${p.day} ${p.month}` : p.day, major })
            d = london_local_to_ms(`${london_date_key(d + 30 * HOUR)}T00:00`)
        }
    }
    else {
        const p = parts_of(range.start, { year: 'numeric', month: 'numeric' })
        let y = +p.year, m = +p.month
        for (;;) {
            const t = london_local_to_ms(`${y}-${String(m).padStart(2, '0')}-01T00:00`)
            if (t >= range.end) break
            if (t >= range.start) {
                const label = m === 1 ? String(y) : fmt({ month: 'short' }).format(new Date(t))
                out.push({ t, x: x(t), label, major: m === 1 })
            }
            if (++m > 12) { m = 1; y++ }
        }
    }
    return out
}

/** Label for the centre of the view, following the zoom. */
export function centre_label (zoom, centre, now = Date.now()) {
    if (zoom === 'hours') {
        const key = london_date_key(centre)
        if (key === london_date_key(now)) return `Today, ${fmt_day(centre)}`
        if (key === london_date_key(now - DAY)) return `Yesterday, ${fmt_day(centre)}`
        return fmt_day(centre)
    }
    if (zoom === 'days' || zoom === 'weeks') {
        // Monday of that week.
        let d = london_start_of_day(centre)
        for (let i = 0; i < 7 && parts_of(d, { weekday: 'short' }).weekday !== 'Mon'; i++) {
            d = london_start_of_day(d - 12 * HOUR)
        }
        return `Week of ${fmt_day(d)}`
    }
    return fmt({ month: 'long', year: 'numeric' }).format(new Date(centre))
}

/* ------------------------------------------------------------------
 * Device metrics, from the ConfigDB origin map
 * ------------------------------------------------------------------ */

/**
 * Walk a Device Information origin map and list the metrics the
 * historian records. Leaves with Record_To_Historian false are left
 * out, because they never reach the data.
 * Each: { path, name, type, unit }.
 */
export function historised_metrics (originMap) {
    const out = []
    const walk = (node, path) => {
        if (!node || typeof node !== 'object') return
        if (node.Sparkplug_Type) {
            if (node.Record_To_Historian === false) return
            out.push({
                path: path.join('/'),
                name: path[path.length - 1] ?? '',
                type: node.Sparkplug_Type,
                unit: node.Eng_Unit ?? null,
            })
            return
        }
        for (const [k, v] of Object.entries(node)) {
            if (k === 'Schema_UUID' || k === 'Instance_UUID' || k.startsWith('$')) continue
            if (v && typeof v === 'object') walk(v, [...path, k])
        }
    }
    walk(originMap, [])
    return out
}

/* ------------------------------------------------------------------
 * Search
 * ------------------------------------------------------------------ */

/** Case-insensitive match on name, tags and extra strings. */
export function matches (r, query, extra = []) {
    const q = (query ?? '').trim().toLowerCase()
    if (!q) return true
    const hay = [r.name ?? '', r.uuid, ...(r.tags ?? []).map(t => `#${t}`), ...extra]
        .join(' ').toLowerCase()
    return q.split(/\s+/).every(w => hay.includes(w))
}
