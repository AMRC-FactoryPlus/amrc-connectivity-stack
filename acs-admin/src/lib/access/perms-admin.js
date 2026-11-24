/*
 * ACS Admin
 * Which access-management controls the logged-in user may use
 * Copyright 2026 University of Sheffield
 */

import { Auth } from "./perms.js";
import { BUILD_DATASETS, DEVICE_DATA, READ_OBJECT } from "./i3x-access.js";

/* The permissions the "Manage access" dialog grants: browse in i3X,
 * build datasets, or both (the Device data composite). */
export const I3X_GRANTS = [READ_OBJECT, BUILD_DATASETS, DEVICE_DATA];

/** Can the user give any i3X or dataset access at all?
 * Auth checks WriteACL against the permission each grant gives.
 * @param check A checker from make_checker.
 */
export function can_give_i3x (check) {
    return I3X_GRANTS.some(p => check.can(Auth.WriteACL, p));
}

/** Can the user remove (or rewrite) these grants?
 * @param check A checker from make_checker.
 * @param grants Grants with a `permission`.
 */
export function can_revoke (check, grants) {
    return grants.every(g => check.can(Auth.WriteACL, g.permission));
}
