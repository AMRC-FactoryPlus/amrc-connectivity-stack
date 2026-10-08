/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Pure logic for the kiosk. The recording itself lives on the server
 * (a Recording entry on the equipment), so the phase is worked out
 * from that. Only two things live on the tablet: a Stop pressed while
 * offline, and the summary of the last save. Storage calls take the
 * storage object as an argument and never throw, so a private window
 * or blocked site data only loses those conveniences.
 */

import { RESUME_WINDOW_MS } from './constants.js'
import { london_date_key, london_local_to_ms } from './model.js'

/* ------------------------------------------------------------------
 * Phase
 * ------------------------------------------------------------------ */

// How long a saved summary is shown again after a reload.
export const SAVED_KEEP_MS = 60 * 60 * 1000

/**
 * The screen to show.
 *
 * @param {Object} s
 * @param {string|null} s.equipment   equipment UUID, or null
 * @param {Object|null} s.recording   the server's Recording entry
 * @param {Object|null} s.pending     a Stop waiting to be sent
 * @param {Object|null} s.saved       the last save on this tablet
 * @param {boolean} s.saving          a Stop is being sent now
 * @param {boolean} s.failed          the last Stop failed on this tablet
 * @returns {'choose'|'ready'|'recording'|'saving'|'queued'|'failed'|'saved'}
 */
export function derive_phase ({ equipment, recording, pending, saved, saving, failed }) {
    if (!equipment) return 'choose'
    if (recording?.startedAt) {
        if (saving) return 'saving'
        // The entry this tablet just saved, before the live update
        // removes it (or if removing it failed). Not a resumed one.
        if (saved?.recordStart === recording.startedAt && recording.resumes !== saved.run) return 'saved'
        if (pending) return 'queued'
        // A stop time on the server means a save was tried and failed,
        // here or on another tablet.
        if (recording.stoppedAt || failed) return 'failed'
        return 'recording'
    }
    if (saving) return 'saving'
    if (saved) return 'saved'
    return 'ready'
}

/**
 * Is a saved summary still worth showing? Not when it is old, or when
 * a newer run exists on the equipment (another tablet recorded since).
 */
export function saved_is_current (saved, runs = [], now = Date.now()) {
    if (!saved?.run) return false
    if (now - (saved.savedAt ?? 0) > SAVED_KEEP_MS) return false
    return !runs.some(r => r.uuid !== saved.run && !r.voided && Date.parse(r.from) > saved.from)
}

/** Time left to resume a run stopped by mistake, in ms (0 when gone). */
export function resume_left (saved, now = Date.now()) {
    if (!saved?.to || saved.added) return 0
    return Math.max(0, saved.to + RESUME_WINDOW_MS - now)
}

/** "4 min left", rounded up so it never says 0 while it still works. */
export function fmt_minutes_left (ms) {
    const m = Math.ceil(ms / 60000)
    return `${m} min left`
}

/* ------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------ */

/**
 * Did a write fail because the tablet could not reach the server?
 * fetch rejects with a TypeError; api.js wraps some failures in a
 * DatasetError with the original message as `detail` and no status.
 */
export function is_network_error (err, online = true) {
    if (!online) return true
    if (!err) return false
    if (err.status) return false
    if (err.name === 'TypeError') return true
    const text = `${err.message ?? ''} ${err.detail ?? ''}`
    return /failed to fetch|network|load failed|offline|timed? ?out/i.test(text)
}

/* ------------------------------------------------------------------
 * Storage on the tablet
 * ------------------------------------------------------------------ */

const KEY = {
    pending:   eq => `acs-kiosk:pending-stop:${eq}`,
    saved:     eq => `acs-kiosk:saved:${eq}`,
    operator:  'acs-kiosk:operator',
    operators: 'acs-kiosk:operators',
}

function read_json (storage, key) {
    try {
        const v = storage?.getItem(key)
        return v ? JSON.parse(v) : null
    }
    catch { return null }
}

function write_json (storage, key, value) {
    try {
        if (value == null) storage?.removeItem(key)
        else storage?.setItem(key, JSON.stringify(value))
        return true
    }
    catch { return false }
}

/** A Stop pressed while offline: { stoppedAt (ms), by }. */
export function read_pending (storage, eq) {
    const p = read_json(storage, KEY.pending(eq))
    return Number.isFinite(p?.stoppedAt) ? p : null
}
export function write_pending (storage, eq, pending) { return write_json(storage, KEY.pending(eq), pending) }
export function clear_pending (storage, eq) { return write_json(storage, KEY.pending(eq), null) }

/** The summary of the last save on this tablet. */
export function read_saved (storage, eq) {
    const s = read_json(storage, KEY.saved(eq))
    return s?.run ? s : null
}
export function write_saved (storage, eq, saved) { return write_json(storage, KEY.saved(eq), saved) }

/** The operator using the tablet now, and the names used recently. */
export function read_operator (storage) {
    try { return storage?.getItem(KEY.operator) || '' }
    catch { return '' }
}
export function write_operator (storage, name) {
    try {
        if (name) storage?.setItem(KEY.operator, name)
        else storage?.removeItem(KEY.operator)
        return true
    }
    catch { return false }
}
export function read_operators (storage) {
    const list = read_json(storage, KEY.operators)
    return Array.isArray(list) ? list.filter(n => typeof n === 'string' && n.trim()) : []
}
export function write_operators (storage, list) { return write_json(storage, KEY.operators, list) }

/** Put a name at the front of the recent list, without duplicates. */
export function remember_name (list, name, max = 8) {
    const n = (name ?? '').trim().replace(/\s+/g, ' ')
    if (!n) return list ?? []
    const rest = (list ?? []).filter(x => x.toLowerCase() !== n.toLowerCase())
    return [n, ...rest].slice(0, max)
}

/* ------------------------------------------------------------------
 * Today's lane
 * ------------------------------------------------------------------ */

export const LANE_HOURS = [6, 18]

/** 06:00 to 18:00 London time on the day of `now`, as ms. */
export function lane_range (now = Date.now()) {
    const day = london_date_key(now)
    const hh = h => String(h).padStart(2, '0')
    return {
        from: london_local_to_ms(`${day}T${hh(LANE_HOURS[0])}:00`),
        to: london_local_to_ms(`${day}T${hh(LANE_HOURS[1])}:00`),
    }
}

/** Ticks every three hours: [{ label: "09:00", left: 25 }]. */
export function lane_ticks (range) {
    const out = []
    const span = LANE_HOURS[1] - LANE_HOURS[0]
    for (let h = LANE_HOURS[0]; h <= LANE_HOURS[1]; h += 3) {
        out.push({ label: `${String(h).padStart(2, '0')}:00`, left: (h - LANE_HOURS[0]) / span * 100 })
    }
    return out
}

/** Position of an instant on the lane, in percent, clamped to 0..100. */
export function lane_pct (t, range) {
    const p = (t - range.from) / (range.to - range.from) * 100
    return Math.max(0, Math.min(100, p))
}

/**
 * Blocks for the lane: today's runs on the equipment and the live
 * recording. Each is { key, left, width, kind, label }, where kind is
 * done, saved, ref, voided or live.
 */
export function lane_blocks ({ runs = [], recording = null, savedRun = null, range, now = Date.now() }) {
    const out = []
    for (const r of runs) {
        const from = Date.parse(r.from), to = Date.parse(r.to)
        if (!(to > range.from && from < range.to)) continue
        const kind = r.voided ? 'voided' : r.uuid === savedRun ? 'saved' : r.reference ? 'ref' : 'done'
        out.push(block(r.uuid, from, to, kind, kind === 'saved' ? 'Saved' : '', range))
    }
    if (recording?.startedAt) {
        const from = Date.parse(recording.startedAt)
        const to = recording.stoppedAt ? Date.parse(recording.stoppedAt) : now
        if (to > range.from && from < range.to) out.push(block('live', from, to, 'live', 'Recording', range))
    }
    return out
}

function block (key, from, to, kind, label, range) {
    const left = lane_pct(from, range)
    const width = Math.max(0.5, lane_pct(to, range) - left)
    // Labels only fit on wider blocks.
    return { key, left, width, kind, label: width > 8 ? label : '' }
}

/* ------------------------------------------------------------------
 * Times in dialogs
 * ------------------------------------------------------------------ */

export const MINUTE = 60 * 1000
export const HOUR = 60 * MINUTE

export const STEPS = [
    { delta: -HOUR, label: '−1 h' },
    { delta: -5 * MINUTE, label: '−5 min' },
    { delta: -MINUTE, label: '−1 min' },
    { delta: MINUTE, label: '+1 min' },
    { delta: 5 * MINUTE, label: '+5 min' },
    { delta: HOUR, label: '+1 h' },
]

/** Move a time by `delta`, never past `now`. */
export function step_time (t, delta, now = Date.now()) {
    return Math.min(now, t + delta)
}

/**
 * A starting guess for a recording someone forgot to start: up to an
 * hour before now, but not before the last run ended, and at least
 * five minutes long. Both ends are on whole minutes.
 */
export function forgot_default (runs = [], now = Date.now()) {
    const to = Math.floor(now / MINUTE) * MINUTE
    const ends = runs.filter(r => !r.voided && r.to).map(r => Date.parse(r.to)).filter(Number.isFinite)
    const lastEnd = Math.max(-Infinity, ...ends)
    const from = Math.min(to - 5 * MINUTE, Math.max(to - HOUR, Math.ceil(lastEnd / MINUTE) * MINUTE))
    return { from, to }
}

/** Runs on the equipment that overlap a window, ignoring voided ones. */
export function overlapping_runs (runs = [], from, to) {
    return runs.filter(r => !r.voided && r.from && r.to && Date.parse(r.from) < to && Date.parse(r.to) > from)
}

/* ------------------------------------------------------------------
 * Equipment and devices
 * ------------------------------------------------------------------ */

/**
 * Online status of the equipment's devices, from the Directory.
 * `devices` are device records with `status: { online } | null`.
 */
export function device_summary (devices = [], statusReady = true) {
    const total = devices.length
    const online = devices.filter(d => d.status?.online).length
    const offline = statusReady ? devices.filter(d => !d.status?.online).map(d => d.name) : []
    let text
    if (!total) text = 'No devices on this equipment'
    else if (!statusReady) text = `${total} ${total === 1 ? 'device' : 'devices'}`
    else text = `${online} of ${total} ${total === 1 ? 'device' : 'devices'} online`
    return { total, online, offline, text, none_online: statusReady && total > 0 && online === 0 }
}

/** The area most of the equipment's devices are in, or null. */
export function main_area (devices = []) {
    const n = new Map()
    for (const d of devices) if (d.area) n.set(d.area, (n.get(d.area) ?? 0) + 1)
    let best = null, most = 0
    for (const [a, c] of n) if (c > most) { best = a; most = c }
    return best
}

/** Tags to offer as one-tap buttons: the equipment's own first. */
export function suggest_tags (runs = [], allTags = [], exclude = [], max = 6) {
    const skip = new Set(exclude.map(t => t.toLowerCase()))
    const out = []
    for (const t of [...runs.flatMap(r => r.tags ?? []), ...allTags]) {
        if (out.length >= max) break
        if (skip.has(t.toLowerCase())) continue
        skip.add(t.toLowerCase())
        out.push(t)
    }
    return out
}
