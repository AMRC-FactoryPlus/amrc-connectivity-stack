/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Pure helpers for the dataset page. Nothing here talks to a service,
 * so all of it is unit-tested in test/datasets-page.test.js.
 */

import { STRUCTURE } from '@/lib/datasets/constants.js'
import { direct_sources, included_in, fmt_window } from '@/lib/datasets/model.js'

// The Data Access "Read dataset" permission, granted by Share.
export const READ_DATASET = 'ec48462e-37eb-4f56-8efa-83d813e85559'

export const TABS = [
    { id: 'overview',  label: 'Overview' },
    { id: 'data',      label: 'Data' },
    { id: 'use',       label: 'Use' },
    { id: 'add-ons',   label: 'Add-ons' },
    { id: 'structure', label: 'Structure' },
]

export const VOID_REASONS = ['Started late', 'Stopped late', 'Test', 'Wrong equipment', 'Other']

/** The tab from the URL, or overview for anything unknown. */
export function tab_of (param) {
    return TABS.some(t => t.id === param) ? param : 'overview'
}

/**
 * The equipment a run was recorded on: from its run metadata, or the
 * source of its session when that is an equipment dataset.
 */
export function equipment_of (rec, byUuid) {
    if (!rec || rec.kind !== 'run') return null
    const id = rec.run?.equipment ?? (rec.structure === STRUCTURE.SESSION ? rec.config?.source : null)
    const eq = id ? byUuid[id] : null
    return eq?.kind === 'equipment' ? eq : (id && !eq ? { uuid: id, missing: true } : null)
}

/**
 * Datasets that include this one, from the structures you can see.
 * `parts` from Data Access is not used: it mixes what a dataset is
 * made of with what includes it. The delete dialog's 409 list is the
 * full picture.
 */
export function included_list (rec, byUuid) {
    if (!rec) return []
    return [...new Set(included_in(rec.uuid, byUuid))].filter(id => id !== rec.uuid)
}

/** Map a device dataset UUID to its device UUID; keep anything else. */
function to_device (id, byUuid) {
    const r = byUuid[id]
    return r?.structure === STRUCTURE.DEVICE && r.config?.source ? r.config.source : id
}

/**
 * Whether the equipment's devices changed after a run was recorded.
 * The run keeps a snapshot in `run.devices` (device datasets or
 * devices). Returns null when nothing can be compared, otherwise
 * { added, removed } as device UUIDs (both empty when unchanged).
 */
export function equipment_change (run_rec, current_device_datasets, byUuid) {
    const snap = run_rec?.run?.devices
    if (!Array.isArray(snap) || !snap.length || !current_device_datasets) return null
    const before = new Set(snap.map(id => to_device(id, byUuid)))
    const now = new Set(current_device_datasets.map(id => to_device(id, byUuid)))
    return {
        added: [...now].filter(d => !before.has(d)),
        removed: [...before].filter(d => !now.has(d)),
    }
}

/**
 * The items a process or part groups. A group is a union of runs, or
 * a session over such a union.
 */
export function group_items (rec, byUuid) {
    const src = direct_sources(rec)
    if (rec?.structure === STRUCTURE.SESSION && src.length === 1) {
        const inner = byUuid[src[0]]
        if (inner?.structure === STRUCTURE.UNION) return direct_sources(inner)
    }
    return src
}

/**
 * Labels set on equipment for its device datasets, for every
 * equipment dataset this one reaches (itself, or the equipment of its
 * runs). Returns { [device dataset uuid]: label }.
 */
export function labels_for (rec, byUuid) {
    const out = {}
    const seen = new Set()
    const walk = id => {
        if (seen.has(id)) return
        seen.add(id)
        const r = byUuid[id]
        if (!r) return
        if (r.kind === 'equipment') Object.assign(out, r.labels ?? {})
        if (r.run?.equipment) walk(r.run.equipment)
        for (const s of direct_sources(r)) walk(s)
    }
    if (rec) walk(rec.uuid)
    return out
}

/* ------------------------------------------------------------------
 * Metrics
 * ------------------------------------------------------------------ */

/** Total historised metrics over a list of devices. */
export function metric_total (devices) {
    return devices.reduce((n, d) => n + (d?.metrics?.length ?? 0), 0)
}

/**
 * Filter each device's metrics by a search. Words must all match the
 * path, name or unit. Devices with no match are dropped while searching.
 */
export function filter_metrics (devices, query) {
    const words = (query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    return devices
        .map(d => ({
            device: d,
            metrics: words.length
                ? (d.metrics ?? []).filter(m => {
                    const hay = `${m.path} ${m.name} ${m.unit ?? ''}`.toLowerCase()
                    return words.every(w => hay.includes(w))
                })
                : (d.metrics ?? []),
        }))
        .filter(g => !words.length || g.metrics.length)
}

/* ------------------------------------------------------------------
 * Structure tree
 * ------------------------------------------------------------------ */

/**
 * Flatten a structure_tree into rows for the Structure tab, each with
 * plain wording. `deviceName(uuid)` names a device. Equipment members
 * carry the label their parent gives them.
 */
export function tree_rows (tree, { deviceName = () => null, now = Date.now() } = {}) {
    const rows = []
    const walk = (node, parent) => {
        const r = node.record
        const label = parent?.kind === 'equipment' ? parent.labels?.[node.uuid] ?? null : null
        rows.push({
            uuid: node.uuid,
            depth: node.depth,
            name: r?.name ?? null,
            kind: r?.kind ?? null,
            structure: node.structure,
            label,
            cycle: node.cycle,
            unknown: !r || (!node.structure && !node.cycle),
            invalid: !!r?.invalid,
            wording: wording(node, deviceName, now),
        })
        if (!node.cycle) for (const c of node.children) walk(c, r)
    }
    walk(tree, null)
    return rows
}

function wording (node, deviceName, now) {
    const r = node.record
    if (node.cycle) return 'already shown above (a loop)'
    if (!r) return 'a dataset you cannot see'
    if (r.invalid) return 'reported as invalid by the service'
    if (!node.structure) return 'structure not visible to you'
    if (node.structure === STRUCTURE.DEVICE) {
        return `device ${deviceName(r.config?.source) ?? r.name ?? r.config?.source ?? 'unknown'}`
    }
    if (node.structure === STRUCTURE.UNION) {
        const n = node.children.length
        return `combines ${n} ${n === 1 ? 'dataset' : 'datasets'}`
    }
    if (node.structure === STRUCTURE.SESSION) {
        return `limited to ${fmt_window(r.config?.from, r.config?.to, now)}`
    }
    return 'unknown structure'
}

/** The service's own name for a structure type. */
export function structure_type (structure) {
    switch (structure) {
        case STRUCTURE.DEVICE:  return 'Sparkplug source'
        case STRUCTURE.UNION:   return 'Union components'
        case STRUCTURE.SESSION: return 'Session limits'
        case STRUCTURE.INVALID: return 'Invalid'
        default:                return 'Unknown'
    }
}
