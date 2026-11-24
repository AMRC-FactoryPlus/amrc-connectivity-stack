/*
 * ACS Edge Scout schemas
 * A plain reference merge, to prove the merge fixtures follow the spec
 * Copyright 2026 University of Sheffield
 *
 * This holds whole snapshots in memory. The Edge Agent streams its
 * merge instead, but must give the same result.
 */

const MAX_BRANCHES = 10;

/* Merges a scan into the current snapshot. `base` and `scan` have the
 * shapes of a merge fixture. Returns the new snapshot, or
 * `{ error: "OPTIONS" }` for a folder_id the base does not have. */
export function merge_scan (base, scan) {
    if (scan.folder_id == null)
        return {
            root:           scan.root,
            options_hash:   scan.options_hash,
            exhaustive:     scan.exhaustive,
            truncated:      scan.truncated,
            reason:         scan.reason,
            excluded:       scan.excluded,
            branches:       [],
            items:          scan.items,
        };

    const parents = new Map(base.items.map(i => [i.id, i.parent]));
    if (!parents.has(scan.folder_id))
        return { error: "OPTIONS" };

    /* Rule 1: the folder and everything whose parent chain reaches it */
    const in_subtree = id => {
        const seen = new Set();
        for (let at = id; at != null && !seen.has(at); at = parents.get(at)) {
            if (at == scan.folder_id) return true;
            seen.add(at);
        }
        return false;
    };
    const kept = base.items.filter(i => !in_subtree(i.id));
    const outside = new Set(kept.map(i => i.id));

    /* Rules 2 and 3: add the new items, the first taking the folder's
     * parent, and drop any whose id is still present outside */
    const added = scan.items
        .map((item, ix) => ix == 0 ? { ...item, parent: parents.get(scan.folder_id) } : item)
        .filter(item => !outside.has(item.id));

    /* Rule 4: the flags */
    const ex_ids = new Set(base.excluded.map(e => e.id));
    return {
        root:           base.root,
        options_hash:   base.options_hash,
        exhaustive:     base.exhaustive && scan.exhaustive,
        truncated:      base.truncated || scan.truncated,
        reason:         scan.truncated ? scan.reason : base.reason,
        excluded:       [...base.excluded, ...scan.excluded.filter(e => !ex_ids.has(e.id))],
        branches:       [...base.branches, { folder_id: scan.folder_id, finished: scan.finished }]
                            .slice(-MAX_BRANCHES),
        items:          [...kept, ...added],
    };
}
