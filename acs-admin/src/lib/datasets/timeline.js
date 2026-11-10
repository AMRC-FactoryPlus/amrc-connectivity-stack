/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Layout for the Datasets timeline: which lanes there are, where they
 * sit, which of them and which blocks are near the viewport, and what
 * a drag selects. Nothing here touches the DOM or a store, so all of it
 * is unit-tested in test/datasets-timeline.test.js.
 */

import { REFERENCE_TYPES } from './constants.js'
import { display_name, london_date_key, london_local_to_ms, london_start_of_day, snap } from './model.js'
import { NO_PATH } from './i3x-devices.js'

const HOUR = 3600e3
const DAY = 24 * HOUR

/** The pinned label column, in px, until someone drags it. */
export const LABEL_W = 260
/** How narrow and how wide the label column can be dragged, in px. */
export const LABEL_W_MIN = 200
export const LABEL_W_MAX = 600
/** The least track a wide label column must leave in view, in px. */
export const TRACK_MIN = 240
/** The tick header, in px. */
export const HEADER_H = 36

/** Lane heights by row kind, in px. */
export const ROW_H = {
    'ongoing-header': 32,
    'band':           36,
    'equipment':      44,
    'device':         36,
    'other-header':   36,
    'place':          28,
}

/* ------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------ */

/** Time to x on the track. */
export function x_of (t, range) {
    return (t - range.start) * range.px_per_ms
}

/** x on the track to time, clamped to the track. */
export function t_of (x, range) {
    const t = range.start + x / range.px_per_ms
    return Math.max(range.start, Math.min(range.end, t))
}

/**
 * The widths the label column can take in a frame `client_width` wide.
 * The top limit drops in a narrow frame so some track always shows,
 * but never below the bottom limit.
 */
export function label_w_limits (client_width = Infinity) {
    const room = Number.isFinite(client_width) ? client_width - TRACK_MIN : LABEL_W_MAX
    return { min: LABEL_W_MIN, max: Math.max(LABEL_W_MIN, Math.min(LABEL_W_MAX, Math.floor(room))) }
}

/**
 * A label column width that fits the limits. Anything that is not a
 * number (nothing saved yet, or a bad saved value) gives the default.
 */
export function clamp_label_w (w, client_width = Infinity) {
    const { min, max } = label_w_limits(client_width)
    const n = typeof w === 'number' && Number.isFinite(w) ? Math.round(w) : LABEL_W
    return Math.max(min, Math.min(max, n))
}

/**
 * The scrollLeft that puts `t` at `anchor` (0 left, 0.5 middle) of
 * the part of the frame the track shows. `label_w` is the label
 * column's width, here and in the two functions below.
 */
export function scroll_left_for (t, range, client_width, anchor = 0.5, label_w = LABEL_W) {
    const view = Math.max(0, client_width - label_w)
    const max = Math.max(0, range.width - view)
    return Math.max(0, Math.min(max, x_of(t, range) - view * anchor))
}

/** The time at the middle of the visible track. */
export function view_centre (range, scroll_left, client_width, label_w = LABEL_W) {
    const view = Math.max(0, client_width - label_w)
    return t_of(scroll_left + view / 2, range)
}

/**
 * Whether a time sits far enough inside the track to scroll to it,
 * rather than rebuilding the track around it.
 */
export function in_track (t, range, margin = 0.1) {
    const m = (range.end - range.start) * margin
    return t > range.start + m && t < range.end - m
}

/** The horizontal band of track (px) worth rendering: the view plus a buffer each side. */
export function visible_x (scroll_left, client_width, buffer = null, label_w = LABEL_W) {
    const view = Math.max(0, client_width - label_w)
    const b = buffer ?? Math.max(400, view)
    return { x0: scroll_left - b, x1: scroll_left + view + b }
}

/** Ticks that fall inside [x0, x1]. */
export function visible_ticks (ticks, x0, x1) {
    return ticks.filter(t => t.x >= x0 && t.x <= x1)
}

/* ------------------------------------------------------------------
 * Navigation
 * ------------------------------------------------------------------ */

/** Noon on the London day `days_back` days before `now`. */
function noon_days_back (days_back, now) {
    let d = london_start_of_day(now)
    for (let i = 0; i < days_back; i++) d = london_start_of_day(d - 12 * HOUR)
    return london_local_to_ms(`${london_date_key(d)}T12:00`)
}

/** Times for the Today and Yesterday buttons and the date popover. */
export function quick_dates (now = Date.now()) {
    const year = london_date_key(now).slice(0, 4)
    return {
        today:      now,
        yesterday:  noon_days_back(1, now),
        week_ago:   now - 7 * DAY,
        month_ago:  now - 30 * DAY,
        year_start: london_local_to_ms(`${year}-01-01T12:00`),
    }
}

/** A "YYYY-MM-DD" value from a date input to noon that day, as ms. */
export function date_input_to_ms (value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return NaN
    return london_local_to_ms(`${value}T12:00`)
}

/* ------------------------------------------------------------------
 * Lanes
 * ------------------------------------------------------------------ */

function text_match (query, strings) {
    const q = (query ?? '').trim().toLowerCase()
    if (!q) return true
    const hay = strings.filter(Boolean).join(' ').toLowerCase()
    return q.split(/\s+/).every(w => hay.includes(w))
}

/**
 * The devices of each piece of equipment, as device rows need them.
 *
 * @param equipment  equipment records
 * @param resolve    uuid -> resolve_devices() result
 * @param byUuid     every dataset record
 * @returns {Object<string, Array<{device, dataset, label}>>}
 */
export function equipment_devices (equipment, resolve, byUuid) {
    const out = {}
    for (const e of equipment) {
        const seen = new Set()
        const list = []
        for (const dd of resolve(e.uuid).device_datasets) {
            const device = byUuid[dd]?.config?.source
            if (!device || seen.has(device)) continue
            seen.add(device)
            list.push({ device, dataset: dd, label: e.labels?.[dd] ?? null })
        }
        out[e.uuid] = list
    }
    return out
}

/**
 * Build every lane, top to bottom, with its position.
 *
 * @param {Object} p
 * @param p.ongoing        datasets with no window: [{ record, devices }]
 * @param p.equipment      equipment records
 * @param p.eq_devices     equipment uuid -> [{ device, dataset, label }]
 * @param p.devices        every device the pages know of (the store's
 *                         deviceIndex), each with its ISA-95 `path`
 * @param p.expanded       { ongoing, other, [equipment uuid],
 *                         [place row key] } booleans. Places are open
 *                         unless set to false; equipment and `other`
 *                         are closed unless set to true.
 * @param p.query          the search box
 * @param p.dataset_of     device uuid -> the uuid of the device's own
 *                         dataset, or null when it has none the person
 *                         can open
 * Groups with nothing in them are left out.
 * @returns {{ rows: Row[], height: number, matched: number }}
 *   `matched` counts bands, equipment and devices that pass the search.
 */
export function build_rows ({ ongoing = [], equipment = [], eq_devices = {}, devices = [], expanded = {}, query = '', dataset_of = () => null }) {
    const rows = []
    let top = 0
    let matched = 0
    const q = (query ?? '').trim()
    const push = r => {
        r.h = ROW_H[r.kind]
        r.top = top
        r.index = rows.length
        top += r.h
        rows.push(r)
    }
    const device_by = Object.fromEntries(devices.map(d => [d.uuid, d]))
    const device_row = (key, uuid, tag, indent) => {
        const d = device_by[uuid]
        return {
            kind: 'device',
            key,
            device: uuid,
            name: d?.name ?? uuid.slice(0, 8),
            // Metric lists come from the ConfigDB, which not everyone can read.
            tag: tag ?? (Array.isArray(d?.metrics) ? metric_count(d.metrics.length) : null),
            status: d?.status ?? null,
            // The device's own dataset: the row's name links to it.
            dataset: dataset_of(uuid) ?? null,
            indent,
        }
    }
    const device_text = d => [d?.name, d?.sparkplug, d?.address, ...(d?.path ?? [])]

    // Ongoing datasets.
    const bands = ongoing.filter(o => text_match(q, [display_name(o.record), ...(o.record.tags ?? []).map(t => `#${t}`)]))
    matched += bands.length
    if (bands.length) {
        const open = q ? true : expanded.ongoing !== false
        push({ kind: 'ongoing-header', key: 'ongoing', name: 'Ongoing, no time window', tag: String(bands.length), open })
        if (open) {
            for (const o of bands) {
                push({
                    kind: 'band',
                    key: `band:${o.record.uuid}`,
                    uuid: o.record.uuid,
                    name: display_name(o.record),
                    label: `Ongoing · ${o.devices} ${o.devices === 1 ? 'device' : 'devices'}`
                        + (o.record.created_by ? ` · made by ${o.record.created_by}` : ''),
                })
            }
        }
    }

    // Equipment and its devices.
    const in_equipment = new Set()
    const sorted = [...equipment].sort((a, b) => display_name(a).localeCompare(display_name(b)))
    for (const e of sorted) {
        const list = eq_devices[e.uuid] ?? []
        for (const x of list) in_equipment.add(x.device)
        const name_hit = text_match(q, [display_name(e), ...(e.tags ?? []).map(t => `#${t}`)])
        const dev_hits = name_hit ? list : list.filter(x => text_match(q, [x.label, ...device_text(device_by[x.device])]))
        if (!name_hit && !dev_hits.length) continue
        matched += 1 + (q ? dev_hits.length : 0)
        const open = q ? true : !!expanded[e.uuid]
        push({
            kind: 'equipment',
            key: `eq:${e.uuid}`,
            uuid: e.uuid,
            name: display_name(e),
            tag: `${list.length} ${list.length === 1 ? 'device' : 'devices'}`,
            open,
        })
        if (open) {
            for (const x of dev_hits) push(device_row(`dev:${e.uuid}:${x.device}`, x.device, x.label, 1))
        }
    }

    // Devices in no equipment, under their ISA-95 path. Devices with
    // no path come last.
    const others = devices
        .filter(d => !in_equipment.has(d.uuid) && text_match(q, device_text(d)))
        .sort((a, b) => (a.path?.length ? 0 : 1) - (b.path?.length ? 0 : 1)
            || place_label(a).localeCompare(place_label(b))
            || (a.name ?? '').localeCompare(b.name ?? ''))
    matched += q ? others.length : 0
    if (others.length) {
        const open = q ? true : !!expanded.other
        push({ kind: 'other-header', key: 'other', name: 'Other devices', tag: `${others.length} not in any equipment`, open })
        if (open) {
            // `others` is sorted by place, so each place is one run.
            const places = []
            for (const d of others) {
                const p = place_label(d)
                if (places.at(-1)?.name !== p) places.push({ name: p, devices: [] })
                places.at(-1).devices.push(d)
            }
            for (const p of places) {
                const key = place_key(p.name)
                const n = p.devices.length
                const place_open = q ? true : expanded[key] !== false
                push({ kind: 'place', key, name: p.name, tag: `${n} ${n === 1 ? 'device' : 'devices'}`, open: place_open })
                if (!place_open) continue
                for (const d of p.devices) push(device_row(`other:${d.uuid}`, d.uuid, null, 1))
            }
        }
    }

    return { rows, height: top, matched }
}

/** "1 metric", "12 metrics". */
export function metric_count (n) {
    return `${n} ${n === 1 ? 'metric' : 'metrics'}`
}

/** The device's ISA-95 path, "Enterprise / Site / Area". */
export function place_label (d) {
    return d?.path?.length ? d.path.join(' / ') : NO_PATH
}

/** The row key of a place heading, which is also its key in `expanded`. */
export function place_key (label) {
    return `place:${label}`
}

/** The index of the row at y (px from the top of the lanes), or -1. */
export function row_at (rows, y) {
    let lo = 0, hi = rows.length - 1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const r = rows[mid]
        if (y < r.top) hi = mid - 1
        else if (y >= r.top + r.h) lo = mid + 1
        else return mid
    }
    return -1
}

/**
 * The rows in or near the vertical view. `scroll_top` and
 * `client_height` are the frame's; the lanes start under the header.
 */
export function visible_rows (rows, scroll_top, client_height, overscan = 400) {
    const y0 = scroll_top - HEADER_H - overscan
    const y1 = scroll_top + client_height + overscan
    let lo = 0, hi = rows.length
    // First row whose bottom is below y0.
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (rows[mid].top + rows[mid].h <= y0) lo = mid + 1
        else hi = mid
    }
    const out = []
    for (let i = lo; i < rows.length && rows[i].top < y1; i++) out.push(rows[i])
    return out
}

/* ------------------------------------------------------------------
 * Recording blocks
 * ------------------------------------------------------------------ */

const REF_LABEL = Object.fromEntries(REFERENCE_TYPES.map(r => [r.id, r.label]))

function cap (s) { return s ? s[0].toUpperCase() + s.slice(1) : s }

/**
 * The blocks for one piece of equipment: its runs, and the recording
 * in progress if there is one. Times are ms. `style` is one of
 * recording, voided, reference, done.
 */
export function equipment_blocks (equipment, runs = [], recording = null, now = Date.now()) {
    const out = []
    const eq_name = display_name(equipment)
    for (const r of runs) {
        const from = Date.parse(r.from), to = Date.parse(r.to)
        if (Number.isNaN(from) || Number.isNaN(to)) continue
        const style = r.voided ? 'voided' : r.reference ? 'reference' : 'done'
        let title = display_name(r)
        if (title.startsWith(`${eq_name} `)) title = cap(title.slice(eq_name.length + 1))
        if (style === 'voided') title = 'Voided'
        else if (style === 'reference') title = `${REF_LABEL[r.reference] ?? cap(String(r.reference))} reference`
        const who = r.run?.operator ?? r.created_by
        out.push({ key: r.uuid, uuid: r.uuid, from, to, style, title, sub: [who, r.tags?.[0]].filter(Boolean).join(' · '), name: display_name(r) })
    }
    if (recording?.startedAt) {
        const from = Date.parse(recording.startedAt)
        if (!Number.isNaN(from)) {
            const who = recording.operator ?? recording.startedBy
            out.push({
                key: `rec:${equipment.uuid}`,
                uuid: null,
                from,
                to: Math.max(from, now),
                style: 'recording',
                title: 'Recording now',
                sub: [who, recording.tags?.[0]].filter(Boolean).join(' · '),
                name: `${eq_name}, recording now`,
            })
        }
    }
    return out
}

/**
 * Place blocks on the track and keep the ones inside [x0, x1]. Each
 * gets left, width and a label inset so the title stays in view when
 * the block starts left of `view_left` (the visible track's left edge).
 */
export function place_blocks (blocks, range, x0, x1, view_left = x0) {
    const out = []
    for (const b of blocks) {
        if (b.to < range.start || b.from > range.end) continue
        const left = x_of(Math.max(b.from, range.start), range)
        const right = x_of(Math.min(b.to, range.end), range)
        if (right < x0 || left > x1) continue
        const w = Math.max(3, right - left)
        const inset = title_inset(left, w, view_left)
        out.push({ ...b, left, w, inset, show_title: w > 44, show_sub: w > 90 })
    }
    return out
}

/** The inset that keeps a block's title in view, given the visible left edge. */
export function title_inset (left, w, view_left) {
    return Math.max(6, Math.min(w - 120, view_left - left + 8))
}

/* ------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------ */

/**
 * What a drag selects. `sel` holds row keys and times as dragged;
 * returns null if either row has gone.
 */
export function resolve_selection (sel, rows, step = 5 * 60 * 1000) {
    if (!sel) return null
    const i0 = rows.findIndex(r => r.key === sel.k0)
    const i1 = rows.findIndex(r => r.key === sel.k1)
    if (i0 < 0 || i1 < 0) return null
    const a = Math.min(i0, i1), b = Math.max(i0, i1)
    const devices = [...new Set(rows.slice(a, b + 1).filter(r => r.kind === 'device').map(r => r.device))]
    const from = snap(Math.min(sel.t0, sel.t1), step)
    const to = snap(Math.max(sel.t0, sel.t1), step)
    return {
        first: a,
        last: b,
        top: rows[a].top,
        height: rows[b].top + rows[b].h - rows[a].top,
        from,
        to,
        devices,
    }
}

/** Device counts for the selection card. */
export function selection_summary (device_uuids, device_by) {
    const devices = device_uuids.map(u => device_by[u] ?? { uuid: u, name: u.slice(0, 8), metrics: [] })
    // Null when a device's metrics are not readable: unknown, not short.
    const metrics = devices.some(d => !Array.isArray(d.metrics)) ? null
        : devices.reduce((n, d) => n + d.metrics.length, 0)
    return {
        count: devices.length,
        metrics,
        shown: devices.slice(0, 4).map(d => ({ uuid: d.uuid, name: d.name })),
        more: Math.max(0, devices.length - 4),
    }
}

/** Where the builder opens for a selection. */
export function make_dataset_query (sel) {
    return {
        devices: sel.devices.join(','),
        from: String(sel.from),
        to: String(sel.to),
    }
}
