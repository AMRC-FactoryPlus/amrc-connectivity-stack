/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Pure functions for the dataset builder and its pickers. Nothing here
 * talks to a service, so all of it is unit-tested in
 * test/datasets-builder.test.js.
 *
 * Builder items are { type: 'device'|'dataset', uuid, label, dataset }.
 * A device item's `uuid` is the device; `dataset` is its device dataset
 * when one is already known (from an edit or duplicate), so saving an
 * unchanged item reuses exactly the dataset it came from.
 */

import { STRUCTURE, KIND_BY_ID } from '@/lib/datasets/constants.js'
import {
    direct_sources, included_in, resolve_devices, device_dataset_for,
    validate_window, to_iso,
} from '@/lib/datasets/model.js'

// Kinds that have no time window of their own.
export const NO_WINDOW_KINDS = ['equipment', 'process', 'part']
// Kinds whose items are runs.
export const GROUP_KINDS = ['process', 'part']

export function empty_state () {
    return {
        name: '',
        description: '',
        kind: null,
        tags: [],
        items: [],
        window_mode: 'none',
        quick: 'custom',
        from: null,
        to: null,
    }
}

/* ------------------------------------------------------------------
 * Items
 * ------------------------------------------------------------------ */

/** A builder item for a dataset UUID: device datasets become devices. */
export function item_for (uuid, byUuid, label = '') {
    const r = byUuid[uuid]
    if (r?.structure === STRUCTURE.DEVICE && r.config?.source) {
        return { type: 'device', uuid: r.config.source, label, dataset: uuid }
    }
    return { type: 'dataset', uuid, label }
}

/**
 * The datasets a dataset is made from, as the builder shows them. A
 * session over its own "(devices)" union shows the union's items, the
 * same rule as edit_shape in api.js (which this file cannot import,
 * because the service client does not load under the unit tests).
 */
export function source_items (rec, byUuid) {
    if (!rec) return []
    if (rec.structure === STRUCTURE.SESSION) {
        const src = byUuid[rec.config?.source]
        if (src?.structure === STRUCTURE.UNION && src.name === `${rec.name} (devices)`) return direct_sources(src)
        return rec.config?.source ? [rec.config.source] : []
    }
    if (rec.structure === STRUCTURE.DEVICE) return [rec.uuid]
    return direct_sources(rec)
}

/**
 * Builder state from an existing dataset, for edit and duplicate.
 * `copy` names it "<name> (copy)".
 */
export function state_from_record (rec, byUuid, { copy = false } = {}) {
    const s = empty_state()
    s.name = copy ? `${rec.name ?? 'Dataset'} (copy)` : (rec.name ?? '')
    s.description = rec.run?.description ?? ''
    s.kind = KIND_BY_ID[rec.kind] ? rec.kind : null
    s.tags = [...(rec.tags ?? [])]
    const labels = rec.labels ?? {}
    s.items = dedupe_items(source_items(rec, byUuid).map(u => item_for(u, byUuid, labels[u] ?? '')))
    const from = rec.structure === STRUCTURE.SESSION ? rec.config?.from : rec.from
    const to = rec.structure === STRUCTURE.SESSION ? rec.config?.to : rec.to
    if (from && to) {
        s.window_mode = 'window'
        s.from = Date.parse(from)
        s.to = Date.parse(to)
    }
    return s
}

/**
 * Builder state from the timeline's selection. Each UUID is a device
 * unless it names a known dataset.
 */
export function state_from_query (query, byUuid) {
    const s = empty_state()
    if (KIND_BY_ID[query.kind]) s.kind = query.kind
    const ids = String(query.devices ?? '').split(',').map(x => x.trim()).filter(Boolean)
    s.items = dedupe_items(ids.map(id => byUuid[id] ? item_for(id, byUuid) : { type: 'device', uuid: id, label: '' }))
    const from = Number(query.from), to = Number(query.to)
    if (query.from != null && query.to != null && Number.isFinite(from) && Number.isFinite(to)) {
        s.window_mode = 'window'
        s.from = from
        s.to = to
    }
    if (s.kind === 'run') s.window_mode = 'window'
    if (NO_WINDOW_KINDS.includes(s.kind)) s.window_mode = 'none'
    return s
}

export function item_key (i) {
    return `${i.type}:${i.uuid}`
}

export function dedupe_items (items) {
    const seen = new Set()
    return items.filter(i => {
        const k = item_key(i)
        if (seen.has(k)) return false
        seen.add(k)
        return true
    })
}

/**
 * The devices the items cover, through datasets. `unknown` counts
 * datasets whose structure you cannot see.
 */
export function covered_devices (items, byUuid) {
    const devices = new Set()
    const unknown = new Set()
    for (const i of items) {
        if (i.type === 'device') { devices.add(i.uuid); continue }
        const r = resolve_devices(i.uuid, byUuid)
        r.devices.forEach(d => devices.add(d))
        r.unknown.forEach(u => unknown.add(u))
    }
    return { devices: [...devices], unknown: [...unknown] }
}

/**
 * Devices that two or more items reach. The CSV then holds their rows
 * more than once. Counted by device, so two device datasets for the
 * same device also count.
 */
export function repeated_devices (items, byUuid) {
    const count = new Map()
    for (const i of items) {
        const devs = i.type === 'device' ? [i.uuid] : resolve_devices(i.uuid, byUuid).devices
        for (const d of new Set(devs)) count.set(d, (count.get(d) ?? 0) + 1)
    }
    return [...count].filter(([, n]) => n > 1).map(([d]) => d)
}

/** Device items with no device dataset yet: [{ device, existing }]. */
export function device_dataset_plan (items, byUuid) {
    return items.filter(i => i.type === 'device').map(i => ({
        device: i.uuid,
        existing: i.dataset ?? device_dataset_for(i.uuid, byUuid),
    }))
}

/**
 * The dataset UUIDs to save, in item order, once device datasets are
 * known. `map` is { [device uuid]: device dataset uuid }.
 */
export function item_datasets (items, map, byUuid) {
    const out = []
    for (const i of items) {
        const u = i.type === 'device' ? (i.dataset ?? map[i.uuid] ?? device_dataset_for(i.uuid, byUuid)) : i.uuid
        if (u && !out.includes(u)) out.push(u)
    }
    return out
}

/** Equipment labels keyed by device dataset UUID. */
export function labels_by_dataset (items, map, byUuid) {
    const out = {}
    for (const i of items) {
        const v = (i.label ?? '').trim()
        if (i.type !== 'device' || !v) continue
        const u = i.dataset ?? map[i.uuid] ?? device_dataset_for(i.uuid, byUuid)
        if (u) out[u] = v
    }
    return out
}

/* ------------------------------------------------------------------
 * Window and validation
 * ------------------------------------------------------------------ */

/** Whether the time window card applies. Edits keep the shape they have. */
export function shows_window (state, edit = null) {
    if (edit) return edit.has_window
    return !NO_WINDOW_KINDS.includes(state.kind)
}

/** The window to save, as ISO strings, or null. */
export function window_of (state, edit = null) {
    if (!shows_window(state, edit) || state.window_mode !== 'window') return null
    if (state.from == null || state.to == null || Number.isNaN(state.from) || Number.isNaN(state.to)) return null
    return { from: to_iso(state.from), to: to_iso(state.to) }
}

/** The window problem, or null. Checks start before end in the UI. */
export function window_problem (state, edit = null) {
    if (!shows_window(state, edit) || state.window_mode !== 'window') return null
    const iso = v => (v == null || Number.isNaN(v)) ? '' : to_iso(v)
    return validate_window(iso(state.from), iso(state.to))
}

/**
 * Everything that stops a save, in the order a person fixes them.
 * `edit` is the result of edit_shape when editing.
 */
export function problems (state, edit = null) {
    const out = []
    const group = GROUP_KINDS.includes(state.kind)
    if (!state.name.trim()) out.push('Give the dataset a name.')
    if (!state.items.length) out.push(group ? 'Add at least one run.' : 'Add at least one device or dataset.')
    if (state.kind === 'equipment' && state.items.some(i => i.type === 'dataset')) {
        out.push('Equipment holds devices only. Remove the datasets.')
    }
    if (group && state.items.some(i => i.type === 'device')) {
        out.push(`A ${state.kind} groups runs. Remove the devices.`)
    }
    if (state.kind === 'run' && !(shows_window(state, edit) && state.window_mode === 'window')) {
        out.push('A run needs a time window.')
    }
    const w = window_problem(state, edit)
    if (w) out.push(w)
    if (edit?.has_window && !edit.items_uuid && state.items.length > 1) {
        out.push('This dataset is limited to one source. Duplicate it to combine several.')
    }
    return out
}

/* ------------------------------------------------------------------
 * What the service will store
 * ------------------------------------------------------------------ */

/**
 * Rows for "What the service will store". Each: { text, note, type }.
 * `steps` is plan(spec) for a new dataset, or null when editing.
 */
export function store_rows (state, byUuid, { steps = null, edit = null, record = null } = {}) {
    const rows = []
    const dd = device_dataset_plan(state.items, byUuid)
    const reused = dd.filter(d => d.existing).length
    const created = dd.length - reused
    if (reused) rows.push({ text: `${reused} device ${reused === 1 ? 'dataset' : 'datasets'} reused`, note: 'Already exist for these devices.', type: 'Sparkplug source' })
    if (created) rows.push({ text: `${created} device ${created === 1 ? 'dataset' : 'datasets'} created`, note: 'Made when you save.', type: 'Sparkplug source' })

    if (steps) {
        for (const s of steps) {
            if (s.structure === STRUCTURE.UNION) {
                rows.push({ text: `Combines ${s.combines} ${s.combines === 1 ? 'item' : 'items'}`, note: s.plumbing ? 'Holds the items for the window below.' : '', type: 'Union components' })
            }
            if (s.structure === STRUCTURE.SESSION) {
                rows.push({ text: 'Limited to a window', note: `${s.from} to ${s.to}`, type: 'Session limits' })
            }
        }
    }
    else if (edit && record) {
        rows.push({ text: 'Changes the existing dataset in place', note: 'Only the parts you change are written.', type: edit.has_window ? 'Session limits' : 'Union components' })
    }

    const k = KIND_BY_ID[state.kind]
    if (k) rows.push({ text: `Kind: ${k.label}`, note: 'Added to the class for this kind.', type: 'Class membership' })
    return rows
}

/* ------------------------------------------------------------------
 * Pickers
 * ------------------------------------------------------------------ */

/**
 * Datasets that include `uuid`, at any depth. Adding one of these to
 * `uuid` would make a loop.
 */
export function ancestors (uuid, byUuid) {
    const out = new Set()
    const todo = [uuid]
    while (todo.length) {
        const id = todo.pop()
        for (const p of included_in(id, byUuid)) {
            if (out.has(p)) continue
            out.add(p)
            todo.push(p)
        }
    }
    return out
}

/** UUIDs the dataset picker leaves out when editing these datasets. */
export function picker_exclusions (uuids, byUuid) {
    const out = new Set()
    for (const u of uuids) {
        if (!u) continue
        out.add(u)
        for (const a of ancestors(u, byUuid)) out.add(a)
    }
    return out
}

/** Device UUID -> names of the equipment that already holds it. */
export function equipment_by_device (equipment, byUuid, nameOf) {
    const out = {}
    for (const eq of equipment) {
        for (const d of resolve_devices(eq.uuid, byUuid).devices) {
            ;(out[d] ??= []).push(nameOf(eq.uuid))
        }
    }
    return out
}

/** Case-insensitive match of every word against some strings. */
export function text_match (query, strings) {
    const q = (query ?? '').trim().toLowerCase()
    if (!q) return true
    const hay = strings.filter(Boolean).join(' ').toLowerCase()
    return q.split(/\s+/).every(w => hay.includes(w))
}

/**
 * Group devices by site, then area, sorted by name.
 * Returns [{ site, areas: [{ area, devices }] }]. Missing values sort last.
 */
export function group_devices (devices) {
    const sites = new Map()
    for (const d of devices) {
        const site = d.site ?? 'No site'
        const area = d.area ?? 'No area'
        if (!sites.has(site)) sites.set(site, new Map())
        const areas = sites.get(site)
        if (!areas.has(area)) areas.set(area, [])
        areas.get(area).push(d)
    }
    const order = (a, b, none) => (a === none) - (b === none) || a.localeCompare(b)
    return [...sites].sort(([a], [b]) => order(a, b, 'No site')).map(([site, areas]) => ({
        site,
        areas: [...areas].sort(([a], [b]) => order(a, b, 'No area')).map(([area, list]) => ({
            area,
            devices: list.sort((x, y) => (x.name ?? '').localeCompare(y.name ?? '')),
        })),
    }))
}
