/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The devices a person can build datasets from, as i3X shows them.
 * i3X lists every device under its deepest ISA-95 level, and shows a
 * person only the devices they may read, so this works for people who
 * cannot read the ConfigDB's device list. Pure functions: unit-tested
 * in test/datasets-i3x-devices.test.js.
 */

// The i3X type of an ISA-95 level object.
export const ISA95_LEVEL_TYPE = 'isa95-level'
// The relationship from a level to what sits directly under it.
export const HAS_CHILDREN = 'i3x:rel:has-children'

// The heading for devices with no ISA-95 path.
export const NO_PATH = 'Not in the ISA-95 hierarchy'

/**
 * The devices under the ISA-95 levels.
 *
 * @param levels   i3X objects of type isa95-level:
 *                 [{ elementId, displayName, parentId }]
 * @param related  the per-level results of a has-children lookup:
 *                 [{ success, elementId, result: [object] }]
 * @returns [{ uuid, name, path, parent }], sorted by path then name.
 *   A child that is not a level is a device: its elementId is the
 *   device UUID and its displayName the device name. `path` is the
 *   names of the levels above it, Enterprise first; `parent` is the
 *   deepest of them.
 */
export function devices_from_tree (levels, related) {
    const level_by = new Map()
    for (const l of levels ?? []) if (l?.elementId) level_by.set(l.elementId, l)

    const paths = new Map()
    const path_of = id => {
        if (paths.has(id)) return paths.get(id)
        const names = []
        const seen = new Set()
        for (let at = id; at && level_by.has(at) && !seen.has(at); at = level_by.get(at).parentId) {
            seen.add(at)
            const l = level_by.get(at)
            names.unshift(l.displayName || at)
        }
        paths.set(id, names)
        return names
    }

    const out = new Map()
    for (const r of related ?? []) {
        if (!r?.success || !Array.isArray(r.result) || !level_by.has(r.elementId)) continue
        for (const c of r.result) {
            const id = c?.elementId
            if (!id || out.has(id) || level_by.has(id) || c.typeElementId === ISA95_LEVEL_TYPE) continue
            out.set(id, {
                uuid: id,
                name: c.displayName || id.slice(0, 8),
                path: [...path_of(r.elementId)],
                parent: r.elementId,
            })
        }
    }
    return sort_devices([...out.values()])
}

/** A device's ISA-95 path as one line. */
export function path_label (path) {
    return path?.length ? path.join(' / ') : NO_PATH
}

// Devices with no path sort last.
function compare_paths (a, b) {
    const x = a?.length ? 0 : 1, y = b?.length ? 0 : 1
    return x - y || path_label(a).localeCompare(path_label(b))
}

function sort_devices (devices) {
    return devices.sort((a, b) => compare_paths(a.path, b.path) || (a.name ?? '').localeCompare(b.name ?? ''))
}

/**
 * Group devices under their ISA-95 path, for the device picker.
 * @returns [{ key, path, label, devices }], groups and devices sorted
 *   by name. Devices with no path come last, under NO_PATH.
 */
export function group_by_path (devices) {
    const groups = new Map()
    for (const d of devices ?? []) {
        const path = d.path ?? []
        const key = path.join('\u0000')
        if (!groups.has(key)) groups.set(key, { key, path, label: path_label(path), devices: [] })
        groups.get(key).devices.push(d)
    }
    return [...groups.values()]
        .sort((a, b) => compare_paths(a.path, b.path))
        .map(g => ({ ...g, devices: g.devices.sort((x, y) => (x.name ?? '').localeCompare(y.name ?? '')) }))
}

/**
 * The chips that filter the picker: the values of the first ISA-95
 * level at which the devices differ. Most sites have one Enterprise,
 * so this is usually its sites.
 * @returns { depth, values } or null when one value covers every level.
 */
export function path_chips (devices) {
    const list = (devices ?? []).filter(d => d.path?.length)
    const depth_max = Math.max(0, ...list.map(d => d.path.length))
    for (let depth = 0; depth < depth_max; depth++) {
        const values = [...new Set(list.map(d => d.path[depth]).filter(Boolean))]
        if (values.length > 1) return { depth, values: values.sort((a, b) => a.localeCompare(b)) }
    }
    return null
}

/**
 * Every device the Datasets pages know of, by UUID: the devices i3X
 * shows, with their ISA-95 path, plus the devices the ConfigDB lists,
 * with their details. Either source can be missing a device the other
 * has. Status comes from the Directory.
 *
 * @param i3x_devices  from devices_from_tree
 * @param configdb     the store's ConfigDB devices: { uuid, name,
 *                     sparkplug, address, site, area, metrics, originMap }
 * @param status       device uuid -> Directory status
 * @returns [{ uuid, name, path, parent, in_i3x, status, ...ConfigDB
 *   details }]. `metrics` is null when the ConfigDB device is not
 *   readable.
 */
export function merge_device_index (i3x_devices, configdb, status = {}) {
    const out = new Map()
    for (const d of i3x_devices ?? []) {
        out.set(d.uuid, {
            uuid: d.uuid, name: d.name, path: d.path ?? [], parent: d.parent ?? null,
            sparkplug: null, address: null, site: null, area: null, metrics: null, originMap: null,
            in_i3x: true, status: status[d.uuid] ?? null,
        })
    }
    for (const d of configdb ?? []) {
        const seen = out.get(d.uuid)
        out.set(d.uuid, {
            ...d,
            name: seen?.name ?? d.name,
            path: seen?.path ?? [],
            parent: seen?.parent ?? null,
            in_i3x: !!seen,
            status: status[d.uuid] ?? null,
        })
    }
    return sort_devices([...out.values()])
}
