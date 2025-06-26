/* ACS ConfigDB
 * Relation definitions
 * Copyright 2025 University of Sheffield AMRC
 */

import { Perm } from "./constants.js";

/*  path    URL path segment for the API
 *  table   Backend table/view
 *  cperm   Class-end permission
 *  operm   Object-end permission
 *  add     Model method to add a relation
 *  remove  Model method to remove a relation
 */

export const Relations = [
    {
        path:   "member",
        table:  "all_membership",
        cperm:  Perm.ReadMembers,
        //operm:  Perm.ReadMemberships,
    }, {
        path:   "direct/member",
        table:  "membership",
        cperm:  Perm.WriteMembers,
        operm:  Perm.WriteMembership,
        add:    m => m.class_add_member,
        remove: m => m.class_remove_member,
    }, {
        path:   "subclass",
        table:  "all_subclass",
        cperm:  Perm.ReadSubclasses,
        //operm:  Perm.ReadSuperclasses,
    }, {
        path:   "direct/subclass",
        table:  "subclass",
        cperm:  Perm.WriteSubclasses,
        operm:  Perm.ReadSubclasses,
        add:    m => m.class_add_subclass,
        remove: m => m.class_remove_subclass,
    },
];

