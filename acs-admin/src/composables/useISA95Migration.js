/*
 * ACS Admin
 * Build ISA-95 vocabulary nodes from the free-text hierarchy values saved
 * on existing devices, so an installation can adopt the controlled
 * vocabulary without retyping its site structure.
 * Copyright 2026 University of Sheffield AMRC
 */

import { UUIDs } from '@amrc-factoryplus/service-client'

import { ISA95_LEVELS, ISA95_LEVEL_CLASSES, ISA95_HIERARCHY_KEY }
    from '@/store/useISA95Store.js'

/* Pull the free-text hierarchy off a device store entry. Returns null when
 * the device has no hierarchy at all. `chain` is the contiguous run of
 * values from Enterprise down; `ignored_tail` is true when values exist
 * below a gap (e.g. an Area with no Site), which cannot be placed in the
 * tree and are left alone. */
export function extract_hierarchy (device) {
    const h = device.deviceInformation?.originMap
        ?.Device_Information?.[ISA95_HIERARCHY_KEY]
    if (!h || typeof h !== 'object') return null

    const values = ISA95_LEVELS.map(l => String(h[l]?.Value ?? '').trim())
    let gap = values.findIndex(v => v === '')
    if (gap === -1) gap = values.length

    const chain = values.slice(0, gap)
    if (chain.length === 0) return null

    return {
        chain,
        ignored_tail: values.slice(gap).some(v => v !== ''),
    }
}

const fold = s => s.trim().toLowerCase()

/* Work out what vocabulary changes are needed to make every device's
 * hierarchy valid. Pure: takes the device store data and the ISA-95 store
 * data, touches nothing.
 *
 * Matching is scoped to the parent: a device value only matches an
 * existing node that is a child of the node matched at the level above
 * (or, for Enterprise, any root). Matching is case-insensitive against
 * canonical names and aliases. When the typed string differs from the
 * canonical name, it is recorded as an alias so the device's exact text
 * resolves to the node.
 *
 * Returns:
 *   creates:  [{ key, level, name, aliases: [], children: [key] }]
 *             new nodes; children only ever reference other new nodes
 *   links:    [{ parent_uuid, child_key }]
 *             new nodes to append to an existing node's children
 *   aliases:  [{ uuid, alias }]
 *             aliases to append to existing nodes
 *   stats:    { imported, no_hierarchy, ignored_tails }
 */
export function plan_import (devices, nodes) {
    const creates = new Map()
    const links   = []
    const aliases = []
    const stats   = { imported: 0, no_hierarchy: 0, ignored_tails: 0 }

    const existing_alias_adds = new Map()

    const match = (scope, value) => scope.find(n =>
        fold(n.name) === fold(value) ||
        n.aliases.some(a => fold(a) === fold(value)))

    const ensure_alias = (node, value) => {
        if (node.name === value) return
        if (node.aliases.includes(value)) return
        if (node.key !== undefined) {
            if (!node.aliases.includes(value)) node.aliases.push(value)
            return
        }
        const pending = existing_alias_adds.get(node.uuid) ?? []
        if (!pending.includes(value)) {
            pending.push(value)
            existing_alias_adds.set(node.uuid, pending)
        }
    }

    for (const device of devices) {
        const h = extract_hierarchy(device)
        if (!h) {
            stats.no_hierarchy++
            continue
        }
        if (h.ignored_tail) stats.ignored_tails++

        let parent = null
        for (let i = 0; i < h.chain.length; i++) {
            const value = h.chain[i]
            const level = ISA95_LEVELS[i]

            /* Candidate nodes: children of the matched parent, or roots.
             * Existing children come from the vocabulary; pending children
             * come from this plan. */
            const scope = []
            if (parent === null) {
                scope.push(...nodes.filter(n => n.level === level))
                for (const c of creates.values())
                    if (c.level === level && c.root) scope.push(c)
            } else if (parent.key !== undefined) {
                for (const k of parent.children) scope.push(creates.get(k))
            } else {
                for (const uuid of parent.children) {
                    const n = nodes.find(n => n.uuid === uuid)
                    if (n) scope.push(n)
                }
                for (const l of links)
                    if (l.parent_uuid === parent.uuid)
                        scope.push(creates.get(l.child_key))
            }

            /* Include aliases pending on existing nodes, so two devices
             * with the same variant spelling match the same node. */
            let node = match(scope.map(n => n.uuid && existing_alias_adds.has(n.uuid)
                ? { ...n, aliases: [...n.aliases, ...existing_alias_adds.get(n.uuid)] }
                : n), value)
            if (node?.uuid) node = scope.find(n => n.uuid === node.uuid)

            if (!node) {
                const key = `${i}:${parent ? (parent.key ?? parent.uuid) : ''}:${fold(value)}`
                node = { key, level, name: value, aliases: [], children: [], root: parent === null }
                creates.set(key, node)
                if (parent === null) {
                    /* Root: nothing to link. */
                } else if (parent.key !== undefined) {
                    parent.children.push(key)
                } else {
                    links.push({ parent_uuid: parent.uuid, child_key: key })
                }
            } else {
                ensure_alias(node, value)
            }
            parent = node
        }
        stats.imported++
    }

    for (const [uuid, add] of existing_alias_adds)
        for (const alias of add) aliases.push({ uuid, alias })

    return { creates: [...creates.values()], links, aliases, stats }
}

/* Apply a plan through the ConfigDB client. Creates the new objects first,
 * then writes every vocabulary config with the real UUIDs resolved. */
export async function apply_plan (cdb, plan, nodes) {
    const uuid_of = new Map()

    for (const c of plan.creates) {
        const uuid = await cdb.create_object(ISA95_LEVEL_CLASSES[c.level])
        uuid_of.set(c.key, uuid)
        await cdb.put_config(UUIDs.App.Info, uuid, { name: c.name })
    }

    for (const c of plan.creates)
        await cdb.put_config(UUIDs.App.ISA95Vocabulary, uuid_of.get(c.key), {
            aliases:  c.aliases,
            children: c.children.map(k => uuid_of.get(k)),
        })

    /* Merge new children and aliases into existing nodes' configs. */
    const updates = new Map()
    const base = uuid => {
        if (!updates.has(uuid)) {
            const n = nodes.find(n => n.uuid === uuid)
            updates.set(uuid, {
                aliases:  [...(n?.aliases ?? [])],
                children: [...(n?.children ?? [])],
            })
        }
        return updates.get(uuid)
    }
    for (const l of plan.links)
        base(l.parent_uuid).children.push(uuid_of.get(l.child_key))
    for (const a of plan.aliases) {
        const u = base(a.uuid)
        if (!u.aliases.includes(a.alias)) u.aliases.push(a.alias)
    }

    for (const [uuid, config] of updates)
        await cdb.put_config(UUIDs.App.ISA95Vocabulary, uuid, config)

    return { created: plan.creates.length, updated: updates.size }
}
