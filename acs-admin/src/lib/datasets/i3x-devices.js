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
 * The device picker's ISA-95 tree. Each level is a node:
 * { key, name, depth, nodes, devices, all }. `nodes` are the levels
 * directly under it and `devices` the devices directly under it, both
 * sorted by name; `all` is the UUIDs of every device at or below it.
 * Devices with no path go under one last root node, `unplaced: true`.
 */
export function device_tree (devices) {
    const roots = new Map()
    let unplaced = null
    const node = (map, key, name, depth) => {
        if (!map.has(name)) map.set(name, { key, name, depth, kids: new Map(), devices: [] })
        return map.get(name)
    }
    for (const d of devices ?? []) {
        const path = d.path ?? []
        let at
        if (!path.length) {
            unplaced ??= { key: '\u0001', name: NO_PATH, depth: 0, kids: new Map(), devices: [], unplaced: true }
            at = unplaced
        }
        else {
            let map = roots
            path.forEach((name, i) => {
                at = node(map, path.slice(0, i + 1).join('\u0000'), name, i)
                map = at.kids
            })
        }
        at.devices.push(d)
    }
    const by_name = (a, b) => (a.name ?? '').localeCompare(b.name ?? '')
    const finish = n => {
        const nodes = [...n.kids.values()].sort(by_name).map(finish)
        const devices = n.devices.sort(by_name)
        const { kids, ...rest } = n
        return { ...rest, nodes, devices, all: [...devices.map(d => d.uuid), ...nodes.flatMap(c => c.all)] }
    }
    const out = [...roots.values()].sort(by_name).map(finish)
    if (unplaced) out.push(finish(unplaced))
    return out
}

/**
 * The picker's rows, top down. A level row is { node, depth, open,
 * uuids }, `uuids` being the devices under it that the search shows;
 * a device row is { device, depth }. An open level lists its levels,
 * then its own devices. A level's contents show when it
 * is open. While searching, only levels with a matching device show,
 * and they are all open.
 *
 * @param tree     from device_tree
 * @param match    device => boolean, or null when not searching
 * @param is_open  node key => boolean
 */
export function tree_rows (tree, { match = null, is_open = () => false } = {}) {
    const rows = []
    const shows = d => !match || match(d)
    const walk = (n, depth) => {
        const uuids = []
        const under = []
        for (const d of n.devices) if (shows(d)) { uuids.push(d.uuid); under.push({ device: d, depth: depth + 1 }) }
        const kids = []
        for (const c of n.nodes) {
            const sub = walk(c, depth + 1)
            if (sub) { uuids.push(...sub.uuids); kids.push(sub) }
        }
        if (!uuids.length) return null
        return { node: n, depth, uuids, kids, under, open: match ? true : !!is_open(n.key) }
    }
    const emit = r => {
        rows.push({ node: r.node, depth: r.depth, open: r.open, uuids: r.uuids })
        if (!r.open) return
        for (const k of r.kids) emit(k)
        rows.push(...r.under)
    }
    for (const n of tree ?? []) {
        const r = walk(n, 0)
        if (r) emit(r)
    }
    return rows
}

/**
 * Nest tree_rows output for rendering: [{ row, children }], where a
 * level's children are the rows under it. The picker wraps each level
 * round its children, so the level's header can stick only while its
 * own rows are in view.
 */
export function nest_rows (rows) {
    const out = []
    const stack = []
    for (const row of rows ?? []) {
        while (stack.length && stack[stack.length - 1].depth >= row.depth) stack.pop()
        const item = { row, children: [] }
        ;(stack.length ? stack[stack.length - 1].children : out).push(item)
        if (row.node) stack.push({ depth: row.depth, children: item.children })
    }
    return out
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
