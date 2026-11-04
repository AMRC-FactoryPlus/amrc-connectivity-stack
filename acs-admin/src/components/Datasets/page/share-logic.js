/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

// Sharing a dataset: the grants a share adds, and the grants already on
// the dataset, by what they allow. Pure, so the Share card's rules can
// be tested without the Auth service.

import { DA } from '@/lib/datasets/constants.js'
import { CREATE_DATASET, USE_FOR_SESSION } from '@/lib/access/device-data.js'
import { READ_DATASET } from './page-logic.js'

// The permissions the Share card lists, in display order.
export const SHARE_PERMS = [
    { id: 'read',    permission: READ_DATASET,    label: 'Can read this dataset' },
    { id: 'session', permission: USE_FOR_SESSION, label: 'Can use it for sessions' },
]

// The grants a share adds: "Read dataset" always, and "Use for session"
// when ticked. Both are on the dataset itself.
export function share_grants ({ principal, dataset, session }) {
    return SHARE_PERMS
        .filter(p => p.id === 'read' || session)
        .map(p => ({ principal, permission: p.permission, target: dataset, plural: false }))
}

// The grants on a dataset, one list per SHARE_PERMS entry, each holding
// a principal once. Grants on anything else, or for another permission,
// are left out.
// @param grants [{ uuid, principal, permission, target, plural }]
// @returns [{ id, label, grants: [grant] }]
export function share_lists (grants, dataset) {
    return SHARE_PERMS.map(p => {
        const seen = new Set()
        const list = []
        for (const g of grants ?? []) {
            if (g.permission !== p.permission || g.target !== dataset || g.plural) continue
            if (seen.has(g.principal)) continue
            seen.add(g.principal)
            list.push(g)
        }
        return { id: p.id, label: p.label, grants: list }
    })
}

// Reads the grants a Share card lists, when the Auth service lets the
// viewer. Grants that cannot be read are skipped.
export async function load_share_grants (auth, dataset) {
    const ids = (await Promise.all(SHARE_PERMS.map(p =>
        auth.find_grants({ permission: p.permission, target: dataset })))).flat()
    const grants = await Promise.all([...new Set(ids ?? [])].map(id =>
        auth.get_grant(id).then(g => ({ ...g, uuid: id })).catch(() => null)))
    return grants.filter(Boolean)
}

// The grant that lets a principal make session datasets: Create dataset
// on the Session structure only.
export function session_maker_grant (principal) {
    return { principal, permission: CREATE_DATASET, target: DA.App.SessionLimits, plural: false }
}

// Whether a principal can make session datasets: true, false, or null
// when their ACL cannot be read.
export async function can_make_sessions (auth, principal) {
    return auth.check_acl(principal, CREATE_DATASET, DA.App.SessionLimits, true)
        .catch(() => null)
}
