/*
 * ACS Admin
 * Which dataset actions the logged-in user's ACL allows
 * Copyright 2026 University of Sheffield
 */

import { Auth, ConfigDB, DataAccess } from '@/lib/access/perms.js'
import { DA } from './constants.js'

/** Dataset actions allowed by an access checker
 * (useAccessStore().check). These only hide controls that would
 * certainly be refused; Data Access still refuses changes to default
 * datasets and the page gates those separately.
 *
 * @param check The checker.
 * @param uuid The dataset, or null for actions on no one dataset.
 */
export function dataset_access (check, uuid = null) {
    const has = (perm) => uuid != null && check.can(perm, uuid)
    const may_create = check.can_any(DataAccess.CreateDataset)
        || check.can_any(DataAccess.UseDevice)
    return {
        /* Data Access lets anyone create a dataset from the sources
         * they hold permission on, so Device data on any device is
         * enough. Include in union and Use for session don't count
         * here: every account holds them on its own datasets. */
        create:         may_create,
        edit:           has(DataAccess.EditDataset),
        delete:         has(DataAccess.DeleteDataset),
        /* Sharing makes grants of these permissions on the dataset. */
        share:          check.can(Auth.WriteACL, DataAccess.ReadDataset),
        share_sessions: check.can(Auth.WriteACL, DataAccess.UseForSession),
        /* Release adds the dataset to Published, withdraw removes it.
         * Withdraw may also write a note on the briefcase, but not
         * always, so that is left to the server. */
        release:        uuid != null
            && check.can(ConfigDB.WriteMembers, DA.Class.Published)
            && check.can(ConfigDB.WriteMemberships, uuid),
        release_policy: check.write_apps(DA.App.ReleasePolicy),
        /* Equipment recording: a Recording entry, then a session run. */
        record:         check.write_apps(DA.App.Recording),
        stop_record:    check.write_apps(DA.App.Recording) && may_create,
    }
}
