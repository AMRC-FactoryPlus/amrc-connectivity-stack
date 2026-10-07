/*
 * ACS Auth service
 * Index of owned objects, kept up to date per Registration change
 * Copyright 2026 University of Sheffield AMRC
 */

import imm from "immutable";

import { Special } from "./uuids.js";

/* Returns the owner key an entry is indexed under, or `undefined` if
 * the entry is not indexed. This must match the filter in
 * `owned_full`. It reads `inf.owner` without a guard on purpose: a
 * Registration entry with no body throws here, at the same update
 * where `owned_full` would throw. */
function owner_of (inf) {
    const { owner } = inf;
    return owner != Special.Unowned ? { owner } : undefined;
}

/** Build the owned index from a full Registration map.
 *
 * This is O(N) in the size of the map. Use it only for a full
 * snapshot.
 *
 * @param regs An immutable Map from object UUID to Registration entry.
 * @returns An immutable Map from owner UUID to an immutable Set of
 * the objects that principal owns. Unowned objects are left out.
 */
export function owned_full (regs) {
    return regs.entrySeq()
        .map(([obj, inf]) => [obj, inf.owner])
        .filter(([obj, owner]) => owner != Special.Unowned)
        .groupBy(([obj, owner]) => owner)
        .toMap()
        .map(es => new imm.Set(es.map(e => e[0])));
}

/** Apply one Registration change to the owned index.
 *
 * The result has the same content as `owned_full(change.map)`. A
 * child update costs O(log N): it removes the object from its old
 * owner's Set and adds it to its new owner's Set. A full snapshot
 * (`change.child == null`) rebuilds the index.
 *
 * @param owned The current index, or `null` before the first change.
 * @param change A value from `ConfigDB#search_app_changes`.
 * @returns The new index.
 */
export function owned_apply (owned, change) {
    const { map, child, previous } = change;
    if (child == null || owned == null)
        return owned_full(map);

    const before = previous.has(child)
        ? owner_of(previous.get(child)) : undefined;
    const after = map.has(child)
        ? owner_of(map.get(child)) : undefined;

    /* Same owner before and after: the index does not change. */
    if (before && after && imm.is(before.owner, after.owner))
        return owned;

    let next = owned;
    if (before) {
        const objs = next.get(before.owner)?.delete(child);
        next = objs?.size ? next.set(before.owner, objs)
            : next.delete(before.owner);
    }
    if (after) {
        next = next.update(after.owner,
            objs => (objs ?? imm.Set()).add(child));
    }
    return next;
}
