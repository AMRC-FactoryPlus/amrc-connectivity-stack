/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Data over time for the Datasets pages, from Data Access
 * POST v1/series: arrival counts per device (data strips), mean per
 * bucket per metric (charts and sparklines) and each device's newest
 * data time ("quiet since"). Also the i3X leaf IDs that let charts
 * carry on live from a subscription.
 *
 * Nothing here talks to a service, so all of it is unit-tested in
 * test/datasets-series.test.js.
 */

import { v5 as uuidv5 } from 'uuid'
import { fmt_clock, fmt_time, london_date_key, london_local_to_ms, london_start_of_day } from './model.js'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/* ------------------------------------------------------------------
 * The contract
 * ------------------------------------------------------------------ */

/** Bucket sizes the service accepts, smallest first. */
export const LADDER = ['10s', '30s', '1m', '5m', '15m', '30m', '1h', '6h', '1d', '1w']

export const STEP_MS = {
    '10s': 10 * SEC, '30s': 30 * SEC, '1m': MIN, '5m': 5 * MIN, '15m': 15 * MIN,
    '30m': 30 * MIN, '1h': HOUR, '6h': 6 * HOUR, '1d': DAY, '1w': 7 * DAY,
}

/** What the service refuses, so the UI can stay inside it. */
export const LIMITS = {
    devices: 500,
    mean: 50,
    buckets: 2000,
    count_span: 14 * DAY,
    mean_span: 400 * DAY,
}

/** The default `last` lookback, and what "no data" then means. */
export const LAST_LOOKBACK = '30d'

/** The i3X namespace for leaf IDs that have no Instance_UUID. */
export const I3X_UUID_NAMESPACE = '11ad7b32-1d32-4c4a-b0c9-fa049208939a'

/** A device with no data for this long counts as quiet. */
export const QUIET_AFTER_MS = 10 * MIN

/** The smallest ladder step that gives at most `points` buckets. */
export function pick_every (from, to, points = 300) {
    const span = Math.max(1, to - from)
    for (const e of LADDER) {
        if (Math.ceil(span / STEP_MS[e]) <= points) return e
    }
    return LADDER[LADDER.length - 1]
}

/** Split a list into pieces of at most `n`. */
export function chunk (list, n) {
    const out = []
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
    return out
}

/** The one-letter type the historian appends: d, i, u, b or s. */
export function type_suffix (sparkplug_type) {
    // Strip a byte-order suffix (FloatLE, UInt32BE), but not the "le" of "Double".
    const t = /^(.+?)(LE|BE)?$/.exec(String(sparkplug_type ?? ''))[1]
    switch (t) {
        case 'Float': case 'Double': return 'd'
        case 'Int8': case 'Int16': case 'Int32': case 'Int64': return 'i'
        case 'UInt8': case 'UInt16': case 'UInt32': case 'UInt64': return 'u'
        case 'Boolean': return 'b'
        default: return 's'
    }
}

/** Whether a metric of this type can be charted. */
export function chartable (sparkplug_type) {
    return type_suffix(sparkplug_type) !== 's'
}

/** The key a chart, a pin and a live value share: device and full metric name. */
export function series_key (device, metric) {
    return `${device}|${metric}`
}

export function split_key (key) {
    const i = key.indexOf('|')
    return i < 0 ? null : { device: key.slice(0, i), metric: key.slice(i + 1) }
}

/** A `mean` entry for the request. `metric` is from historised_metrics(). */
export function mean_entry (device, metric) {
    const e = { device, metric: metric.path }
    const t = metric.type ? type_suffix(metric.type) : null
    if (t && t !== 's') e.type = t
    return e
}

/**
 * The request body. Exactly one of `devices` and `dataset`. Times are
 * ms or anything Date takes. Without `every`, the service picks a step
 * from `points`.
 */
export function series_request ({ devices = null, dataset = null, from, to, every = null, points = null, count = false, mean = [], last = null }) {
    const body = {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
    }
    if (dataset) body.dataset = dataset
    else body.devices = [...new Set(devices ?? [])]
    if (every) body.every = every
    else if (points) body.points = points
    if (count) body.count = true
    if (mean?.length) body.mean = mean
    if (last) body.last = last === true ? true : { lookback: last }
    return body
}

/** What a dataset with no window shows: the last 24 hours. */
export const NO_WINDOW_SPAN = 24 * HOUR

/**
 * The window a dataset page charts, in ms. A dataset with no time
 * window (or an open end) shows the last 24 hours up to now; `open`
 * says the end follows now.
 */
export function dataset_window (rec, now = Date.now()) {
    const from = rec?.from ? Date.parse(rec.from) : null
    const to = rec?.to ? Date.parse(rec.to) : null
    if (from != null && to != null && from < to) return { from, to, open: false, windowless: false }
    if (from != null && to == null && from < now) return { from, to: now, open: true, windowless: false }
    if (to != null && from == null) return { from: to - NO_WINDOW_SPAN, to, open: false, windowless: false }
    return { from: now - NO_WINDOW_SPAN, to: now, open: true, windowless: true }
}

/** Whether a window takes live values. */
export function window_is_live (w, now = Date.now()) {
    return w.from <= now && (w.open || w.to >= now)
}

/** Whether a count over this window needs the phase 2 summary. */
export function count_too_long (from, to) {
    return to - from > LIMITS.count_span
}

/* ------------------------------------------------------------------
 * Reading the answer
 * ------------------------------------------------------------------ */

const ms = t => t == null ? null : (typeof t === 'number' ? t : Date.parse(t))

/**
 * Turn a response into ms times and sorted arrays:
 * {
 *   from, to, every, step, asOf, source,
 *   devices: { uuid: { windows: [[ms, ms]], count: [[ms, n]], last: ms|null|undefined } },
 *   metrics: { key: { device, metric, type, unit, points: [[ms, mean, n]] } },
 *   denied: [uuid],
 * }
 * `last` is undefined when the request did not ask for it.
 */
export function parse_series (body) {
    const every = body?.every ?? null
    const out = {
        from: ms(body?.from),
        to: ms(body?.to),
        every,
        step: STEP_MS[every] ?? null,
        asOf: ms(body?.asOf) ?? Date.now(),
        source: body?.source ?? 'raw',
        devices: {},
        metrics: {},
        denied: Array.isArray(body?.denied) ? body.denied : [],
    }
    for (const [uuid, d] of Object.entries(body?.devices ?? {})) {
        out.devices[uuid] = {
            windows: (d?.windows ?? []).map(([a, b]) => [ms(a), ms(b)]),
            count: sorted_rows(d?.count),
            last: d && 'last' in d ? ms(d.last) : undefined,
        }
    }
    for (const m of body?.metrics ?? []) {
        if (!m?.device || m.metric == null) continue
        out.metrics[series_key(m.device, m.metric)] = {
            device: m.device,
            metric: m.metric,
            type: m.type ?? null,
            unit: m.unit ?? null,
            points: sorted_rows(m.points),
        }
    }
    return out
}

function sorted_rows (rows) {
    if (!Array.isArray(rows)) return []
    return rows.filter(r => Array.isArray(r) && Number.isFinite(r[0])).slice().sort((a, b) => a[0] - b[0])
}

/** A message people can act on, from a failed request. */
export function series_error (status, body) {
    const said = typeof body?.message === 'string' ? body.message : null
    switch (status) {
        case 400: return 'The service could not read the request.'
        case 403: return 'You do not have permission to read this data.'
        case 404: return 'The service cannot find this dataset.'
        case 413: return said ? `Too much at once: ${said}` : 'Too many devices or metrics for one request.'
        case 422:
            if (/coverage/i.test(said ?? '')) return 'Data for windows over 14 days needs a newer Data Access.'
            return said ?? 'The service refused the request.'
        case 503: return 'The historian is not reachable.'
        case 504: return 'The data took too long to load. Try a shorter window.'
        default: return status ? `The data did not load (HTTP ${status}).` : 'The data did not load.'
    }
}

/* ------------------------------------------------------------------
 * Buckets
 * ------------------------------------------------------------------ */

/**
 * The start of the bucket holding `t`. Steps up to 6 h align to UTC.
 * 1d and 1w align to London midnight and Monday, as the service does.
 */
export function bucket_start (t, every) {
    if (every === '1d') return london_start_of_day(t)
    if (every === '1w') {
        let d = london_start_of_day(t)
        for (let i = 0; i < 7; i++) {
            const day = new Date(london_local_to_ms(`${london_date_key(d)}T12:00`)).getUTCDay()
            if (day === 1) break
            d = london_start_of_day(d - 12 * HOUR)
        }
        return d
    }
    const step = STEP_MS[every]
    return Math.floor(t / step) * step
}

/** The end of the bucket that starts at `start`. */
export function bucket_end (start, every) {
    if (every === '1d') return london_start_of_day(start + 36 * HOUR)
    if (every === '1w') return london_start_of_day(start + 7 * DAY + 12 * HOUR)
    return start + STEP_MS[every]
}

/** A live value as a number, or null if it cannot be charted. */
export function live_number (v) {
    if (typeof v === 'boolean') return v ? 1 : 0
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) return +v
    return null
}

/**
 * Fold one live value into `[start, mean, n]` points (design 2.7).
 * Values at or before `asOf` are already in the series and are
 * ignored. A value in an existing bucket updates its mean with the n
 * weights; otherwise it opens a bucket with n = 1. Returns new points,
 * or the same array when nothing changed.
 */
export function fold_live (points, t, value, every, asOf) {
    const v = live_number(value)
    if (v == null || !Number.isFinite(t) || t <= asOf || !STEP_MS[every]) return points
    const b = bucket_start(t, every)
    const out = points.slice()
    let i = out.length - 1
    while (i >= 0 && out[i][0] > b) i--
    if (i >= 0 && out[i][0] === b) {
        const [, mean, n] = out[i]
        out[i] = [b, (mean * n + v) / (n + 1), n + 1]
    }
    else {
        out.splice(i + 1, 0, [b, v, 1])
    }
    return out
}

/**
 * The window to refetch so the newest two buckets are repaired: from
 * the start of the bucket before the one holding `now` to the end of
 * the series.
 */
export function tail_window (series, now = Date.now()) {
    const t = Math.min(now, series.to - 1)
    const cur = bucket_start(t, series.every)
    const prev = bucket_start(cur - 1, series.every)
    return { from: Math.max(series.from, prev), to: series.to }
}

/**
 * Put a refetched tail into a series: rows from `tail.from` on are
 * replaced. Returns a new series with the tail's asOf.
 */
export function replace_tail (series, tail) {
    const cut = tail.from
    const keep = rows => rows.filter(r => r[0] < cut)
    // The tail asks for the same things, so anything it leaves out had
    // no data in the tail.
    const devices = {}
    for (const uuid of new Set([...Object.keys(series.devices), ...Object.keys(tail.devices)])) {
        const old = series.devices[uuid] ?? { windows: tail.devices[uuid].windows, count: [], last: undefined }
        const d = tail.devices[uuid]
        devices[uuid] = {
            ...old,
            count: [...keep(old.count), ...(d?.count ?? [])],
            // The tail looks back less far, so its null keeps what we had.
            last: d?.last != null ? d.last : old.last,
        }
    }
    const metrics = {}
    for (const key of new Set([...Object.keys(series.metrics), ...Object.keys(tail.metrics)])) {
        const old = series.metrics[key], m = tail.metrics[key]
        if (!old) { metrics[key] = m; continue }
        metrics[key] = {
            ...old,
            unit: m?.unit ?? old.unit,
            type: m?.type ?? old.type,
            points: [...keep(old.points), ...(m?.points ?? [])],
        }
    }
    return { ...series, devices, metrics, asOf: Math.max(series.asOf, tail.asOf) }
}

/** Points as chart pairs, with a null wherever a bucket is missing, so lines break at gaps. */
export function chart_pairs (points, every) {
    const out = []
    let prev = null
    for (const [t, v] of points) {
        if (prev != null && t > bucket_end(prev, every) + 1) out.push([bucket_end(prev, every), null])
        out.push([t, v])
        prev = t
    }
    return out
}

/** Smallest and largest mean. */
export function extent (points) {
    let lo = Infinity, hi = -Infinity
    for (const p of points) {
        if (p[1] < lo) lo = p[1]
        if (p[1] > hi) hi = p[1]
    }
    return lo <= hi ? [lo, hi] : null
}

/**
 * An SVG path for a sparkline `w` by `h` over [from, to]. Each bucket
 * is drawn at its middle; a missing bucket breaks the line.
 */
export function sparkline_path (points, { from, to, w, h, every, pad = 2 }) {
    const ext = extent(points)
    if (!ext || to <= from) return ''
    const [lo, hi] = ext
    const step = STEP_MS[every] ?? 0
    const x = t => ((t + step / 2 - from) / (to - from)) * w
    const y = v => hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad)
    const r = n => Math.round(n * 10) / 10
    let d = ''
    let prev = null
    for (const [t, v] of points) {
        if (t < from - step || t > to) continue
        const gap = prev == null || t > bucket_end(prev, every) + 1
        d += `${gap ? 'M' : 'L'}${r(Math.max(0, Math.min(w, x(t))))} ${r(y(v))}`
        prev = t
    }
    // A single point is a dot, drawn as a short line.
    return d.includes('L') || !d ? d : `${d}h1`
}

/* ------------------------------------------------------------------
 * Data strips
 * ------------------------------------------------------------------ */

/** Cell colour from count and the busiest bucket, 0.45 to 0.85 slate. */
export function density_alpha (n, max) {
    if (!(n > 0)) return 0
    if (!(max > 1) || n >= max) return 0.85
    return 0.45 + 0.4 * (Math.log(n) / Math.log(max))
}

export function density_colour (n, max) {
    const a = density_alpha(n, max)
    return a ? `rgba(15,23,42,${a.toFixed(2)})` : null
}

/**
 * Cells for a timeline strip: one per bucket with data, placed on the
 * track. `range` is the track (start, px_per_ms). Only cells inside
 * [x0, x1] are returned. Each: { x, w, n, colour }.
 */
export function bucket_cells (counts, { range, every, x0 = -Infinity, x1 = Infinity, gap = 1, max = null }) {
    const top = max ?? counts.reduce((m, [, n]) => Math.max(m, n), 0)
    const out = []
    for (const [t, n] of counts) {
        if (!(n > 0)) continue
        const x = (t - range.start) * range.px_per_ms
        const w = (bucket_end(t, every) - t) * range.px_per_ms - gap
        if (x + w < x0 || x > x1) continue
        out.push({ x, w: Math.max(1, w), n, colour: density_colour(n, top) })
    }
    return out
}

/** Sum sparse counts into `bins` equal bins over [from, to). */
export function bin_counts (counts, from, to, bins) {
    const out = new Array(bins).fill(0)
    const span = to - from
    if (!(span > 0) || !bins) return out
    for (const [t, n] of counts) {
        if (t < from || t >= to) continue
        out[Math.min(bins - 1, Math.floor(((t - from) / span) * bins))] += n
    }
    return out
}

/**
 * A strip `width` px wide over [from, to), for the devices table.
 * Cells are `cell` px with a 1px gap. Each: { x, w, n, colour }.
 * `gaps` counts runs of empty cells between cells with data.
 */
export function window_strip (counts, { from, to, width = 240, cell = 4 }) {
    const bins = Math.max(1, Math.floor(width / cell))
    const sums = bin_counts(counts, from, to, bins)
    const max = Math.max(0, ...sums)
    const cells = []
    let gaps = 0, seen = false, empty = false
    sums.forEach((n, i) => {
        if (n > 0) {
            if (seen && empty) gaps++
            seen = true
            empty = false
            cells.push({ x: i * cell, w: cell - 1, n, colour: density_colour(n, max) })
        }
        else if (seen) empty = true
    })
    return { cells, gaps, any: seen }
}

/** Add several devices' counts bucket by bucket, for a collapsed equipment row. */
export function sum_counts (lists) {
    const m = new Map()
    for (const list of lists) for (const [t, n] of list) m.set(t, (m.get(t) ?? 0) + n)
    return [...m].sort((a, b) => a[0] - b[0])
}

/**
 * Remembers strip counts per device and bucket, so scrolling back does
 * not fetch again. Counts are kept in chunks (an hour by default). A
 * chunk fetched after it ended is final; one fetched while open is
 * fetched again once it has ended. The newest buckets are refreshed
 * by polling the tail.
 */
export class StripCache {
    constructor ({ every = '5m', chunk_ms = HOUR } = {}) {
        this.every = every
        this.step = STEP_MS[every]
        this.chunk_ms = chunk_ms
        this.counts = new Map()   // device -> Map(bucket start -> n)
        this.loaded = new Map()   // device -> Map(chunk start -> final?)
    }

    chunks (from, to) {
        const out = []
        for (let c = Math.floor(from / this.chunk_ms) * this.chunk_ms; c < to; c += this.chunk_ms) out.push(c)
        return out
    }

    /**
     * What to fetch to show [from, to) for these devices: one window
     * and the devices that need anything in it, or null. Chunks that
     * start after `now` have no data yet and are skipped.
     */
    missing (devices, from, to, now = Date.now()) {
        const need = new Set()
        let lo = Infinity, hi = -Infinity
        const chunks = this.chunks(from, Math.min(to, now))
        for (const d of devices) {
            const have = this.loaded.get(d)
            for (const c of chunks) {
                const end = c + this.chunk_ms
                const state = have?.get(c)
                // Fetched while open and it has ended since: fetch again.
                if (state === true || (state === false && end > now)) continue
                need.add(d)
                lo = Math.min(lo, c)
                hi = Math.max(hi, end)
            }
        }
        return need.size ? { devices: [...need], from: lo, to: hi } : null
    }

    /**
     * Store an answer for `devices` over [from, to). A device with no
     * counts in the answer had no data then.
     */
    put (devices, from, to, series) {
        for (const d of devices) {
            let m = this.counts.get(d)
            if (!m) this.counts.set(d, m = new Map())
            for (const t of [...m.keys()]) if (t >= from && t < to) m.delete(t)
            for (const [t, n] of series.devices[d]?.count ?? []) if (t >= from && t < to) m.set(t, n)
            let have = this.loaded.get(d)
            if (!have) this.loaded.set(d, have = new Map())
            for (const c of this.chunks(from, to)) {
                if (c < from || c + this.chunk_ms > to) continue
                have.set(c, c + this.chunk_ms <= series.asOf)
            }
        }
    }

    /** Sorted [start, n] rows for a device over [from, to). */
    get (device, from = -Infinity, to = Infinity) {
        const m = this.counts.get(device)
        if (!m) return []
        return [...m].filter(([t]) => t >= from && t < to).sort((a, b) => a[0] - b[0])
    }

    /** The busiest bucket a device has had, for shading. */
    max (device) {
        let top = 0
        for (const n of this.counts.get(device)?.values() ?? []) if (n > top) top = n
        return top
    }

    clear () {
        this.counts.clear()
        this.loaded.clear()
    }
}

/* ------------------------------------------------------------------
 * Quiet since
 * ------------------------------------------------------------------ */

/** "08:51" today, "Wed 7 Oct, 08:51" on another day. */
export function fmt_since (t, now = Date.now()) {
    return london_date_key(t) === london_date_key(now) ? fmt_clock(t) : fmt_time(t, now)
}

/**
 * One status per device, from the Directory (`status`, its Sparkplug
 * session) and the newest data time (`last`: ms, null for none in the
 * lookback, undefined for not known yet).
 *   live:    online and data arrived recently
 *   quiet:   online but no recent data
 *   offline: the Directory says offline
 * Returns { state, label, dot, text, since }, `since` being the time a
 * quiet note starts from.
 */
export function device_status (status, last, now = Date.now(), quiet_after = QUIET_AFTER_MS) {
    const old = last === null || (last != null && now - last > quiet_after)
    const since = last != null && old ? last : null
    if (!status) {
        return { state: 'unknown', label: 'Status unknown', dot: 'bg-slate-300', text: 'text-slate-500', since }
    }
    if (!status.online) {
        const when = status.last_change ? ` since ${fmt_since(Date.parse(status.last_change), now)}` : ''
        return { state: 'offline', label: `Offline${when}`, dot: 'bg-slate-400', text: 'text-slate-500', since }
    }
    if (old) {
        return {
            state: 'quiet',
            label: last === null ? 'Quiet for more than 30 days' : `Quiet since ${fmt_since(last, now)}`,
            dot: 'bg-amber-500',
            text: 'text-amber-700',
            since,
        }
    }
    return { state: 'live', label: 'Live', dot: 'bg-green-500', text: 'text-green-700', since: null }
}

/** The amber note on a quiet device lane. */
export function quiet_note (last, now = Date.now()) {
    if (last === null) return 'No data in the last 30 days'
    return `No data since ${fmt_since(last, now)}`
}

/* ------------------------------------------------------------------
 * i3X leaf IDs (design 1.4)
 *
 * i3X names a leaf metric by its Instance_UUID, or by
 * uuidv5("<parentId>:<key>", I3X_UUID_NAMESPACE) where parentId is the
 * containing object's ID, worked out the same way from the device UUID
 * down. This follows buildTreeFromOriginMap in acs-i3x/lib/object-tree.ts.
 * ------------------------------------------------------------------ */

// Keys i3X treats as metadata, not as objects.
const I3X_METADATA_KEYS = new Set([
    'Schema_UUID', 'Instance_UUID', 'Method', 'Address', 'Path',
    'Documentation', 'Sparkplug_Type', 'Record_To_Historian',
    'Eng_Unit', 'Eng_Low', 'Eng_High', 'Deadband', 'Tooltip',
    'Value', 'value',
])

function has_children (entry) {
    for (const [k, v] of Object.entries(entry)) {
        if (I3X_METADATA_KEYS.has(k)) continue
        if (v != null && typeof v === 'object') return true
    }
    return false
}

function i3x_id (entry, parent, key) {
    return entry.Instance_UUID ?? uuidv5(`${parent}:${key}`, I3X_UUID_NAMESPACE)
}

/**
 * Every leaf metric in an origin map as i3X names it:
 * Map(full metric name -> elementId).
 */
export function i3x_leaf_ids (originMap, device) {
    const out = new Map()
    const walk = (node, parent, prefix) => {
        if (node == null || typeof node !== 'object') return
        for (const [key, value] of Object.entries(node)) {
            if (I3X_METADATA_KEYS.has(key)) continue
            if (value == null || typeof value !== 'object') continue
            const typed = typeof value.Sparkplug_Type === 'string'
            const children = has_children(value)
            if (!typed && !children) continue
            const id = i3x_id(value, parent, key)
            const path = prefix ? `${prefix}/${key}` : key
            if (typed && !children) out.set(path, id)
            else walk(value, id, path)
        }
    }
    walk(originMap, device, '')
    return out
}

/**
 * The i3X elementId of one metric, walking only its path. Null when
 * i3X would not have it as a leaf.
 */
export function i3x_leaf_id (originMap, device, path) {
    let node = originMap
    let parent = device
    const keys = String(path ?? '').split('/')
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (!key || I3X_METADATA_KEYS.has(key)) return null
        const entry = node?.[key]
        if (entry == null || typeof entry !== 'object') return null
        const typed = typeof entry.Sparkplug_Type === 'string'
        const children = has_children(entry)
        if (!typed && !children) return null
        const id = i3x_id(entry, parent, key)
        const leaf = typed && !children
        if (i === keys.length - 1) return leaf ? id : null
        if (leaf) return null
        node = entry
        parent = id
    }
    return null
}

/* ------------------------------------------------------------------
 * Labels and the shared time axis
 * ------------------------------------------------------------------ */

/**
 * A readable label from a metric name: underscores to spaces, sentence
 * case. Words in capitals (RMS, X) stay as they are.
 * "Spindle_Speed" -> "Spindle speed".
 */
export function metric_label (name) {
    const words = String(name ?? '').split(/[_\s]+/).filter(Boolean)
    return words.map((w, i) => {
        if (w.length > 1 && w === w.toUpperCase()) return w
        const lower = w.toLowerCase()
        return i === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower
    }).join(' ')
}

const TICK_STEPS = [MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR]

/**
 * Ticks for a time axis over [from, to] in London time, at most `n`.
 * Each: { t, frac (0 to 1), label, major }. Midnights are major and
 * show the day.
 */
export function axis_ticks (from, to, n = 8) {
    const span = to - from
    if (!(span > 0)) return []
    const out = []
    const push = t => {
        const midnight = london_start_of_day(t) === t
        out.push({ t, frac: (t - from) / span, label: midnight ? fmt_day_short(t) : fmt_clock(t), major: midnight })
    }
    const step = TICK_STEPS.find(s => Math.floor(span / s) + 1 <= n)
    if (step) {
        // London is a whole number of hours from UTC, so steps up to an
        // hour align the same in both. Longer steps align to the London clock.
        const base = step <= HOUR ? step : HOUR
        for (let t = Math.ceil(from / base) * base; t <= to; t += base) {
            if (step > HOUR && london_hour(t) % (step / HOUR)) continue
            push(t)
        }
        return out
    }
    // Days: every k-th London midnight.
    const days = Math.ceil(span / DAY)
    const k = Math.max(1, Math.ceil(days / n))
    let i = 0
    for (let d = london_start_of_day(from); d <= to; d = london_start_of_day(d + 36 * HOUR), i++) {
        if (d >= from && i % k === 0) push(d)
    }
    return out
}

function london_hour (t) {
    return +fmt_clock(t).slice(0, 2)
}

function fmt_day_short (t) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(t)).replace(',', '')
}
