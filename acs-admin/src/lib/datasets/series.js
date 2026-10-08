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

/** The fewest and most points a chart asks for, whatever its width. */
export const CHART_POINTS = { min: 200, max: 1500 }

/** Points for a chart `width` px wide: about one per pixel. */
export function points_for_width (width) {
    const w = Number.isFinite(width) && width > 0 ? Math.round(width) : CHART_POINTS.min
    return Math.max(CHART_POINTS.min, Math.min(CHART_POINTS.max, w))
}

/**
 * The finest ladder step for a chart `width` px wide over [from, to):
 * about one bucket per pixel, and never more buckets than the service
 * allows. 24 hours at 1,500 px gives 1 minute; an hour gives 10 s.
 */
export function every_for_width (from, to, width) {
    return pick_every(from, to, Math.min(points_for_width(width), LIMITS.buckets - 1))
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
    const t = /^(.*?)(LE|BE)?$/.exec(String(sparkplug_type ?? ''))[1]
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
 * The window a dataset page charts, in ms. Equipment that is recording
 * shows that recording, from its start up to now (`recording` is its
 * start). A dataset with no time window (or an open end) shows the last
 * 24 hours up to now; `open` says the end follows now.
 */
export function dataset_window (rec, now = Date.now()) {
    const started = rec?.recording?.startedAt ? Date.parse(rec.recording.startedAt) : null
    if (Number.isFinite(started) && started < now) {
        return { from: started, to: now, open: true, windowless: false, recording: started }
    }
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

/** Whether a count over this window needs the coverage summary. */
export function count_too_long (from, to) {
    return to - from > LIMITS.count_span
}

/** Steps the coverage summary answers counts for, smallest first. */
export const COVERAGE_STEPS = ['1h', '6h', '1d', '1w']

/** What a strip shows while the coverage summary is still being built. */
export const COVERAGE_NOTE = 'Long-range data strips appear once the coverage summary has been built.'

/**
 * How many buckets of `every` overlap [from, to). Stops counting above
 * `cap`, which keeps calendar steps over long spans cheap.
 */
export function bucket_total (from, to, every, cap = Infinity) {
    if (!(to > from) || !STEP_MS[every]) return 0
    if (every !== '1d' && every !== '1w') {
        const step = STEP_MS[every]
        return Math.floor((to - 1) / step) - Math.floor(from / step) + 1
    }
    let n = 0
    for (let t = bucket_start(from, every); t < to && n <= cap; t = bucket_end(t, every)) n++
    return n
}

/**
 * The smallest coverage step, from `min` up, that gives at most `max`
 * buckets over [from, to). The largest step when none does.
 */
export function coverage_every (from, to, { min = '1h', max = LIMITS.buckets } = {}) {
    const steps = COVERAGE_STEPS.slice(Math.max(0, COVERAGE_STEPS.indexOf(min)))
    return steps.find(e => bucket_total(from, to, e, max) <= max) ?? steps[steps.length - 1]
}

/** The strip step each timeline zoom prefers: one cell is 10 to 26 px. */
export const ZOOM_STRIP_EVERY = { hours: '5m', days: '1h', weeks: '6h', years: '1d' }

/**
 * The strip step for a zoom over the span in view. Hours zoom always
 * uses 5 minutes (long spans are split into several requests). The
 * other zooms use the coverage summary's steps, coarser when the
 * preferred one would give more than `max` buckets.
 */
export function strip_every (zoom, from, to, max = LIMITS.buckets) {
    const want = ZOOM_STRIP_EVERY[zoom] ?? '5m'
    if (want === '5m') return want
    return coverage_every(from, to, { min: want, max })
}

/** Whether an error from fetch_series says the coverage summary is not ready. */
export function coverage_not_ready (err) {
    return err?.status === 422 && /coverage summary/i.test(`${err?.detail ?? ''} ${err?.message ?? ''}`)
}

/**
 * The mean device a 422 names as not in the dataset, or null. A pin
 * can go stale when a device leaves a dataset.
 */
export function stray_mean_device (err) {
    if (err?.status !== 422) return null
    return /"mean" device ([0-9a-f-]{36}) is not in/i.exec(err?.detail ?? '')?.[1] ?? null
}

/**
 * The span `mean` may cover: the whole window, or its most recent 400
 * days. `clamped` says the start moved.
 */
export function mean_window (from, to) {
    if (to - from <= LIMITS.mean_span) return { from, to, clamped: false }
    return { from: to - LIMITS.mean_span, to, clamped: true }
}

/* ------------------------------------------------------------------
 * Reading the answer
 * ------------------------------------------------------------------ */

const ms = t => t == null ? null : (typeof t === 'number' ? t : Date.parse(t))

/**
 * Turn a response into ms times and sorted arrays:
 * {
 *   from, to, every, step, asOf, source,
 *   devices: { uuid: { windows: [[ms, ms]] | null, count: [[ms, n]], last: ms|null|undefined } },
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
        // Ranges the coverage summary has not reached yet.
        pending: (Array.isArray(body?.pending) ? body.pending : [])
            .map(r => Array.isArray(r) ? [ms(r[0]), ms(r[1])] : null)
            .filter(r => r && Number.isFinite(r[0]) && Number.isFinite(r[1])),
        devices: {},
        metrics: {},
        denied: Array.isArray(body?.denied) ? body.denied : [],
    }
    for (const [uuid, d] of Object.entries(body?.devices ?? {})) {
        out.devices[uuid] = {
            // Null when the answer gave none (a devices request); [] means none overlap.
            windows: Array.isArray(d?.windows) ? d.windows.map(([a, b]) => [ms(a), ms(b)]) : null,
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
            if (/coverage summary/i.test(said ?? '')) return COVERAGE_NOTE
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

/** Whether an i3X quality can be charted. A value with no quality counts as good. */
export function good_quality (quality) {
    return quality == null || quality === 'Good'
}

/** How much raw live data a series keeps after its newest bucket. */
export const LIVE_TAIL = { span: 10 * MIN, points: 2000 }

/** Keep the newest LIVE_TAIL of a sorted raw tail. */
function bound_tail (tail) {
    if (!tail.length) return tail
    const cut = tail[tail.length - 1][0] - LIVE_TAIL.span
    let i = 0
    while (i < tail.length && tail[i][0] < cut) i++
    i = Math.max(i, tail.length - LIVE_TAIL.points)
    return i ? tail.slice(i) : tail
}

/** The newest time a series already holds for a metric. */
function live_floor (s, metrics, key, device) {
    const last = s.devices?.[device]?.last
    const tail = metrics?.[key]?.tail
    return Math.max(
        s.asOf ?? -Infinity,
        tail?.length ? tail[tail.length - 1][0] : -Infinity,
        typeof last === 'number' ? last : -Infinity,
    )
}

/**
 * Add a batch of i3X items to a parsed series as raw live values
 * (design 2.7). Each metric keeps a `tail` of [ms, value] rows after
 * its buckets, drawn at full resolution, bounded by LIVE_TAIL.
 *
 * `lookup(elementId)` gives { device, path, unit } or nothing. A value
 * is skipped when it is at or before any of: the series' asOf (the
 * buckets hold it), the newest raw value already kept for that series,
 * or its device's newest data time in the last answer. So an SSE
 * replay, or a value that a refetch already counted, is never counted
 * twice. Values whose quality is not good are not charted.
 *
 * Returns the new series, or the same object when nothing changed.
 */
export function append_live_items (s, items, lookup) {
    if (!s?.every || !Array.isArray(items)) return s
    let metrics = null
    const touched = new Set()
    for (const item of items) {
        if (!good_quality(item?.quality)) continue
        const e = lookup(item?.elementId)
        if (!e) continue
        const t = Date.parse(item.timestamp)
        const v = live_number(item.value)
        if (!Number.isFinite(t) || v == null) continue
        const key = series_key(e.device, e.path)
        if (t <= live_floor(s, metrics ?? s.metrics, key, e.device)) continue
        metrics ??= { ...s.metrics }
        const m = metrics[key] ?? { device: e.device, metric: e.path, type: null, unit: e.unit ?? null, points: [] }
        // Copy a tail once per batch, then push onto the copy.
        const tail = touched.has(key) ? m.tail : [...(m.tail ?? [])]
        tail.push([t, v])
        metrics[key] = { ...m, tail }
        touched.add(key)
    }
    if (!metrics) return s
    for (const key of touched) metrics[key] = { ...metrics[key], tail: bound_tail(metrics[key].tail) }
    return { ...s, metrics }
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
 * replaced. Raw live values at or before the new asOf are now counted
 * in the buckets, so they are dropped. Returns a new series with the
 * tail's asOf.
 */
export function replace_tail (series, tail) {
    const cut = tail.from
    const keep = rows => rows.filter(r => r[0] < cut)
    const asOf = Math.max(series.asOf, tail.asOf)
    const raw = rows => rows?.length ? rows.filter(r => r[0] > asOf) : rows
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
        if (old.tail) metrics[key].tail = raw(old.tail)
    }
    return { ...series, devices, metrics, asOf }
}

/** Raw live values further apart than this break the line. */
export const TAIL_GAP_MS = MIN

/** Whether two neighbouring raw values have a gap between them. */
const raw_gap = (a, b, step) => b - a > Math.max(step, TAIL_GAP_MS)

/**
 * Points as chart pairs, with a null wherever a bucket is missing, so
 * lines break at gaps. Raw live values (`tail`, [ms, value] rows) draw
 * at full resolution over the buckets: a bucket holding any raw value
 * gives way to them, and the rest of the buckets stay.
 */
export function chart_pairs (points, every, tail = []) {
    const step = STEP_MS[every] ?? 0
    const raw = tail ?? []
    const covered = new Set(raw.map(([t]) => bucket_start(t, every)))
    const items = [
        ...points.filter(p => !covered.has(p[0])).map(([t, v]) => [t, v, true]),
        ...raw.map(([t, v]) => [t, v, false]),
    ].sort((a, b) => a[0] - b[0])
    const out = []
    let prev = null
    for (const [t, v, bucket] of items) {
        if (prev) {
            const end = prev.bucket ? bucket_end(prev.t, every) : prev.t
            // Bucket to bucket: any missing bucket. Otherwise a silence.
            const gap = prev.bucket && bucket ? t > end + 1 : raw_gap(end, t, step)
            if (gap) out.push([end, null])
        }
        out.push([t, v])
        prev = { t, bucket }
    }
    return out
}

/** A metric's newest value as [ms, value]: the newest raw value, or the newest bucket. */
export function latest_point (m) {
    const raw = m?.tail?.at(-1)
    if (raw) return raw
    const b = m?.points?.at(-1)
    return b ? [b[0], b[1]] : null
}

/**
 * The faint joins across gaps in chart rows: for each break (a null)
 * between two real points, a segment from the point before to the
 * point after, then a null so segments stay apart. Nothing joins past
 * the newest point or before the first.
 */
export function gap_joins (rows) {
    const out = []
    let last = null
    let broken = false
    for (const r of rows) {
        if (r[1] == null) { if (last) broken = true; continue }
        if (broken && last) out.push([last[0], last[1]], [r[0], r[1]], [r[0], null])
        broken = false
        last = r
    }
    return out
}

/**
 * The y range for chart rows in view [from, to]: the values inside it,
 * and the value carried in from before `from` (the line enters from
 * the left at that height), padded by `pad` of the range each side. A
 * flat line gets a band of 10% of its value (or 1) around it. Null
 * when nothing is in view.
 */
export function y_range (rows, from, to, pad = 0.1) {
    let lo = Infinity, hi = -Infinity
    let carried = null
    for (const [t, v] of rows) {
        if (t < from) { carried = v; continue }
        if (t > to) break
        if (v == null) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
    }
    if (carried != null) { lo = Math.min(lo, carried); hi = Math.max(hi, carried) }
    if (!(lo <= hi)) return null
    if (lo === hi) {
        const band = Math.abs(lo) * 0.1 || 1
        return { min: lo - band, max: hi + band }
    }
    const p = (hi - lo) * pad
    return { min: lo - p, max: hi + p }
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
 * An SVG path for a sparkline `w` by `h` over [from, to], from
 * display_rows() rows ([ms, value|null]). A null breaks the line. With
 * `step`, each value holds until the next one (step after).
 */
export function sparkline_path (rows, { from, to, w, h, step = false, pad = 2, range = null }) {
    const shown = rows.filter(([t]) => t <= to)
    // Fitted to the values in view (and the one carried in from the left).
    const fit = range ?? y_range(shown, from, to, 0)
    if (!fit || to <= from) return ''
    const lo = fit.min, hi = fit.max
    const x = t => Math.max(0, Math.min(w, ((t - from) / (to - from)) * w))
    const y = v => hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad)
    const r = n => Math.round(n * 10) / 10
    let d = ''
    let prev = null
    for (const [t, v] of shown) {
        if (v == null) { prev = null; continue }
        if (prev == null) d += `M${r(x(t))} ${r(y(v))}`
        else if (step) d += `H${r(x(t))}V${r(y(v))}`
        else d += `L${r(x(t))} ${r(y(v))}`
        prev = v
    }
    // A single point is a dot, drawn as a short line.
    return /[LHV]/.test(d) || !d ? d : `${d}h1`
}

/* ------------------------------------------------------------------
 * What a chart draws
 * ------------------------------------------------------------------ */

/**
 * What a chart or sparkline draws for one metric: [ms, value|null]
 * rows, always drawn as steps (hold, then jump). Sparkplug reports by
 * exception, so a value holds until the next one: nothing is
 * interpolated.
 *
 * Each bucket's mean is a flat level across its bucket. A bucket with
 * no value holds the last value while the device sent something then
 * (`active(bucket start)`); where the device sent nothing at all the
 * line breaks (a null), and the chart joins the break faintly. Raw
 * live values (`tail`) take over from the bucket they fall in, at full
 * resolution. The first row may come from before the view, so the
 * value carries in from the left edge. The newest bucket's level ends
 * at its own end, or at `until` (now) if sooner; the newest raw value
 * ends at its own time.
 */
export function display_rows (m, every, { active = null, until = Infinity } = {}) {
    const pts = m?.points ?? []
    const tail = (m?.tail ?? []).filter(([t]) => t <= until)
    if (!STEP_MS[every]) return { rows: [], step: true }
    const busy = active ?? (() => true)
    const rows = []
    const rawFrom = tail.length ? bucket_start(tail[0][0], every) : Infinity
    let last = null
    if (pts.length) {
        const means = new Map(pts.map(p => [p[0], p[1]]))
        const lastBucket = bucket_end(pts[pts.length - 1][0], every)
        const end = Math.min(Number.isFinite(until) ? until : lastBucket, rawFrom)
        for (let t = pts[0][0], i = 0; t < end && i < 20000; t = bucket_end(t, every), i++) {
            if (means.has(t)) {
                last = means.get(t)
                rows.push([t, last])
            }
            else if (busy(t)) {
                if (last != null) rows.push([t, last])
            }
            else if (rows.length && rows[rows.length - 1][1] != null) {
                rows.push([t, null])
            }
        }
        // The newest level ends with its bucket (or now), unless raw values follow.
        const top = rows[rows.length - 1]
        if (!tail.length && top && top[1] != null) {
            const close = Math.min(bucket_end(top[0], every), until)
            if (close > top[0]) rows.push([close, top[1]])
        }
    }
    const after = rows.length ? rows[rows.length - 1][0] : -Infinity
    for (const [t, v] of tail) {
        if (t <= after) continue
        rows.push([t, v])
    }
    return { rows, step: true }
}

/* ------------------------------------------------------------------
 * Live, at the zoom in view
 * ------------------------------------------------------------------ */

/** The coarsest bucket that still streams each value as it arrives. */
export const STREAM_MAX_STEP = 30 * SEC

/** How often a view that includes now refetches its newest bucket, at most. */
export const TAIL_REFRESH_MS = 5 * MIN

/**
 * How a view of [from, to] behaves at this bucket size:
 *   live:   the view includes now and keeps updating (the badge)
 *   stream: values are drawn as they arrive, from an i3X subscription,
 *           only for buckets of 30 s or less
 *   hint:   at coarser buckets, how often the line moves
 * `window_live` says the dataset's own window takes live values.
 */
export function live_mode ({ from, to }, every, now, window_live = true) {
    const step = STEP_MS[every] ?? Infinity
    const live = !!window_live && from <= now && to >= now - step
    const stream = live && step <= STREAM_MAX_STEP
    let hint = null
    if (live && !stream) hint = `Updates every ${fmt_every(Math.min(step, TAIL_REFRESH_MS))}`
    return { live, stream, hint }
}

function fmt_every (ms) {
    if (ms < MIN) return `${Math.round(ms / SEC)} s`
    if (ms < HOUR) return `${Math.round(ms / MIN)} min`
    return `${Math.round(ms / HOUR)} h`
}

/* ------------------------------------------------------------------
 * A cache of chart data
 * ------------------------------------------------------------------ */

/**
 * Bucket means (and device counts, for knowing when a device sent
 * anything) for one bucket size, kept in chunks so panning back costs
 * nothing. A chunk fetched after it ended is final; the newest buckets
 * are refreshed with put(..., { final: false }).
 */
export class SeriesCache {
    constructor (every) {
        this.every = every
        this.step = STEP_MS[every]
        const chunk = every === '1d' || every === '1w' ? '1w' : 250 * this.step
        this.book = new StripCache({ every, chunk })
        this.metrics = new Map()   // key -> Map(bucket start -> [mean, n])
        this.meta = new Map()      // key -> { device, metric, unit, type }
        this.counts = new Map()    // device -> Map(bucket start -> n)
        this.counted = []          // [[from, to]] ranges with counts
        this.asOf = -Infinity
        // Everything up to this time has been fetched, without a hole,
        // at the newest edge. A chunk still open when fetched is only
        // complete up to here; later answers that start at or before it
        // move it on.
        this.through = -Infinity
    }

    /**
     * The stretch at the newest edge not fetched since the open chunk
     * was loaded, up to `to`, or null. This happens when the view
     * leaves this bucket size for a while and the newest buckets were
     * refreshed for another one.
     */
    stale (to, now = Date.now()) {
        if (!Number.isFinite(this.through)) return null
        const end = Math.min(to, now)
        if (end <= this.through + this.step) return null
        return { from: bucket_start(this.through, this.every), to: bucket_end(bucket_start(end, this.every), this.every) }
    }

    /** The range to fetch to show [from, to), or null. */
    missing (from, to, now = Date.now()) {
        return this.book.missing(['*'], from, to, now)
    }

    pieces (from, to, max = LIMITS.buckets - 1) {
        return this.book.pieces(from, to, max)
    }

    /**
     * Store an answer for [from, to). `keys` are the metrics asked for;
     * one the answer leaves out had no data then. With `final` false
     * the chunks are not marked as loaded (a refresh of the newest
     * buckets).
     */
    put (from, to, s, { keys = [], final = true, counted = false } = {}) {
        const inside = t => t >= from && t < to
        for (const key of new Set([...keys, ...Object.keys(s.metrics ?? {})])) {
            let m = this.metrics.get(key)
            if (!m) this.metrics.set(key, m = new Map())
            for (const t of [...m.keys()]) if (inside(t)) m.delete(t)
            const got = s.metrics?.[key]
            if (!got) continue
            for (const [t, mean, n] of got.points) if (inside(t)) m.set(t, [mean, n])
            const old = this.meta.get(key)
            this.meta.set(key, { device: got.device, metric: got.metric, unit: got.unit ?? old?.unit ?? null, type: got.type ?? old?.type ?? null })
        }
        if (counted) {
            for (const [d, dev] of Object.entries(s.devices ?? {})) {
                let c = this.counts.get(d)
                if (!c) this.counts.set(d, c = new Map())
                for (const t of [...c.keys()]) if (inside(t)) c.delete(t)
                for (const [t, n] of dev.count ?? []) if (inside(t) && n > 0) c.set(t, n)
            }
            this.counted.push([from, to])
        }
        if (final) this.book.put(['*'], from, to, s)
        if (Number.isFinite(s.asOf)) {
            this.asOf = Math.max(this.asOf, s.asOf)
            // An answer that reaches its asOf moves the edge on, if it
            // starts at or before the edge (or sets it the first time).
            const reaches = s.asOf >= from && s.asOf <= to + this.step
            if (reaches && (this.through === -Infinity || from <= this.through)) this.through = Math.max(this.through, s.asOf)
        }
    }

    /** Whether device counts cover [from, to). */
    has_counts (from, to) {
        const spans = this.counted.slice().sort((a, b) => a[0] - b[0])
        let at = from
        for (const [a, b] of spans) {
            if (a > at) break
            at = Math.max(at, b)
            if (at >= to) return true
        }
        return at >= to
    }

    /** A parsed-series view of [from, to) for these keys. */
    view (from, to, keys) {
        const metrics = {}
        for (const key of keys) {
            const m = this.metrics.get(key)
            const meta = this.meta.get(key) ?? { ...split_key(key), unit: null, type: null }
            const points = m ? [...m].filter(([t]) => t >= from && t < to).map(([t, [mean, n]]) => [t, mean, n]).sort((a, b) => a[0] - b[0]) : []
            metrics[key] = { device: meta.device, metric: meta.metric, unit: meta.unit, type: meta.type, points }
        }
        return { from, to, every: this.every, step: this.step, asOf: this.asOf, metrics }
    }

    /** Whether a device sent anything in the bucket starting at t. */
    active (device, t) {
        return (this.counts.get(device)?.get(t) ?? 0) > 0
    }

    /** The end of a device's newest bucket with data, or null. */
    newest (device) {
        let top = null
        for (const t of this.counts.get(device)?.keys() ?? []) if (top == null || t > top) top = t
        return top == null ? null : bucket_end(top, this.every)
    }
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
 * The chunk each strip step is cached in. A chunk always starts on a
 * bucket boundary: fixed lengths for steps that align to UTC, London
 * weeks for days and weeks.
 */
export const STRIP_CHUNK = { '5m': HOUR, '1h': DAY, '6h': DAY, '1d': '1w', '1w': '1w' }

// How long to wait before asking again for a range the coverage
// summary has not reached yet.
const PENDING_RETRY_MS = 5 * MIN

/**
 * Remembers strip counts per device and bucket, so scrolling back does
 * not fetch again. Counts are kept in chunks (STRIP_CHUNK). A chunk
 * fetched after it ended is final; one fetched while open is fetched
 * again once it has ended; one the coverage summary has not reached
 * yet is fetched again after a few minutes. The newest buckets are
 * refreshed by polling the tail.
 */
export class StripCache {
    constructor ({ every = '5m', chunk = null, chunk_ms = null } = {}) {
        this.every = every
        this.step = STEP_MS[every]
        this.chunk = chunk ?? chunk_ms ?? STRIP_CHUNK[every] ?? HOUR
        this.counts = new Map()   // device -> Map(bucket start -> n)
        // device -> Map(chunk start -> true when final, or the time
        // from which to fetch it again)
        this.loaded = new Map()
    }

    chunk_start (t) {
        return typeof this.chunk === 'number' ? Math.floor(t / this.chunk) * this.chunk : bucket_start(t, this.chunk)
    }

    chunk_end (c) {
        return typeof this.chunk === 'number' ? c + this.chunk : bucket_end(c, this.chunk)
    }

    chunks (from, to) {
        const out = []
        for (let c = this.chunk_start(from); c < to; c = this.chunk_end(c)) out.push(c)
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
                const state = have?.get(c)
                if (state === true || (typeof state === 'number' && state > now)) continue
                need.add(d)
                lo = Math.min(lo, c)
                hi = Math.max(hi, this.chunk_end(c))
            }
        }
        return need.size ? { devices: [...need], from: lo, to: hi } : null
    }

    /**
     * Split [from, to) at chunk boundaries into pieces of at most
     * `max` buckets each, so no request goes over the service's limit.
     */
    pieces (from, to, max = LIMITS.buckets) {
        const out = []
        let start = null, n = 0
        for (const c of this.chunks(from, to)) {
            const end = Math.min(this.chunk_end(c), to)
            const k = bucket_total(Math.max(c, from), end, this.every)
            if (start != null && n + k > max) {
                out.push({ from: start, to: Math.max(c, from) })
                start = null
                n = 0
            }
            if (start == null) start = Math.max(c, from)
            n += k
        }
        if (start != null) out.push({ from: start, to })
        return out
    }

    /**
     * Store an answer for `devices` over [from, to). A device with no
     * counts in the answer had no data then.
     */
    put (devices, from, to, series) {
        const pending = series.pending ?? []
        for (const d of devices) {
            let m = this.counts.get(d)
            if (!m) this.counts.set(d, m = new Map())
            for (const t of [...m.keys()]) if (t >= from && t < to) m.delete(t)
            for (const [t, n] of series.devices[d]?.count ?? []) if (t >= from && t < to) m.set(t, n)
            let have = this.loaded.get(d)
            if (!have) this.loaded.set(d, have = new Map())
            for (const c of this.chunks(from, to)) {
                const end = this.chunk_end(c)
                if (c < from || end > to) continue
                if (pending.some(([a, b]) => a < end && b > c)) have.set(c, series.asOf + PENDING_RETRY_MS)
                else have.set(c, end <= series.asOf ? true : end)
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

/**
 * A device's windows less the ranges the coverage summary has not
 * reached, so time with no answer yet is neither data nor a gap.
 * `windows` null means the whole of [from, to).
 */
export function usable_windows (windows, pending, from, to) {
    let spans = (windows ?? [[from, to]]).map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => a < b)
    for (const [pa, pb] of pending ?? []) {
        const next = []
        for (const [a, b] of spans) {
            if (pb <= a || pa >= b) { next.push([a, b]); continue }
            if (pa > a) next.push([a, pa])
            if (pb < b) next.push([pb, b])
        }
        spans = next
    }
    return spans
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
        // Capitals (RMS, X, S1) stay as they are.
        if (w === w.toUpperCase() && /[A-Z]/.test(w)) return w
        const lower = w.toLowerCase()
        return i === 0 ? lower[0].toUpperCase() + lower.slice(1) : lower
    }).join(' ')
}

/* "Axes" -> "Axis", "Spindles" -> "Spindle", "Batteries" -> "Battery". */
function singular (word) {
    if (/^axes$/i.test(word)) return word.slice(0, -2) + 'is'
    if (/ies$/i.test(word)) return word.slice(0, -3) + 'y'
    return word.slice(0, -1)
}

/* A folder that holds several of one thing: "Axes", "Spindles". */
const is_collection = seg => seg.length > 3 && /[^s]s$/i.test(seg) && !/_/.test(seg)

/*
 * Words for the kept segments of one path. A kept segment whose parent
 * is a collection gets the singular as a qualifier: "X" under "Axes"
 * reads "X axis", "S1" under "Spindles" reads "Spindle S1".
 */
function label_words (segs, kept) {
    const out = []
    for (const i of kept) {
        const seg = segs[i]
        const parent = segs[i - 1]
        if (i < segs.length - 1 && parent && !kept.includes(i - 1) && is_collection(parent)) {
            const one = singular(parent)
            out.push(seg.length === 1 ? `${seg}_${one}` : `${one}_${seg}`)
        }
        else out.push(seg)
    }
    return out.join('_')
}

/**
 * Labels for one device's metrics: Map(full path -> label). A label is
 * metric_label() of the last segment, unless two metrics would share
 * it; then each of those adds the path segments that tell them apart.
 * Segments close to the leaf that do not help (Base_Axis) are left out
 * again when the labels stay unique. So Axes/X/Base_Axis/Load,
 * Axes/Y/Base_Axis/Load and Spindles/S1/Load read "X axis load",
 * "Y axis load" and "Spindle S1 load".
 */
export function metric_labels (paths) {
    const list = [...new Set((paths ?? []).map(p => String(p ?? '')))]
    const segs = new Map(list.map(p => [p, p.split('/').filter(Boolean)]))
    // Kept segment indexes per path, always ending with the leaf.
    const kept = new Map(list.map(p => [p, [Math.max(0, segs.get(p).length - 1)]]))
    const text = p => metric_label(label_words(segs.get(p), kept.get(p)))
    const clashes = () => {
        const by = new Map()
        for (const p of list) {
            const k = text(p).toLowerCase()
            by.set(k, [...(by.get(k) ?? []), p])
        }
        return [...by.values()].filter(g => g.length > 1)
    }
    const unique = () => new Set(list.map(p => text(p).toLowerCase())).size === list.length
    // Add segments, nearest the leaf first, until every label is unique.
    const groups = []
    for (let round = 0; round < 64; round++) {
        const found = clashes()
        let grew = false
        for (const g of found) {
            groups.push(g)
            for (const p of g) {
                const k = kept.get(p)
                if (k[0] > 0) { kept.set(p, [k[0] - 1, ...k]); grew = true }
            }
        }
        if (!grew) break
    }
    // Leave out segments that do not help, for a whole group at once,
    // nearest the leaf first: Base_Axis in Axes/X/Base_Axis/Load.
    for (const g of groups.reverse()) {
        for (let pos = 1; g.every(p => kept.get(p).length > pos);) {
            const before = g.map(p => [p, kept.get(p)])
            for (const [p, k] of before) kept.set(p, k.filter((_, j) => j !== k.length - 1 - pos))
            if (unique()) continue
            for (const [p, k] of before) kept.set(p, k)
            pos++
        }
    }
    return new Map(list.map(p => [p, text(p)]))
}

const label_cache = new WeakMap()

/** metric_labels() for a device's metric list ({ path }), remembered per list. */
export function device_metric_labels (metrics) {
    if (!Array.isArray(metrics)) return new Map()
    let m = label_cache.get(metrics)
    if (!m) label_cache.set(metrics, m = metric_labels(metrics.map(x => x.path)))
    return m
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
