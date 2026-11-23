/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Saving a value into an edge cluster's sealed secret.
 *
 * The Cluster Manager seals the value with the cluster's kubeseal
 * certificate and commits it to the cluster's Git repo, and Flux then
 * applies it on the edge. Its answers (acs-cluster-manager
 * lib/edge-deploy.js and lib/secrets.js) are 204 when saved, 403 without
 * the Manage secrets permission on the cluster, 404 for a cluster it
 * doesn't know, 503 when the cluster hasn't reported its kubeseal
 * certificate, and 500 when the commit failed.
 *
 * The service client doesn't throw on a refusal, so every caller has to
 * look at the status. Before this helper none did, so a refused save
 * looked like a success and the edge agent later found no secret. */

import { UUIDs } from '@amrc-factoryplus/service-client'

/** A secret the Cluster Manager didn't save, with a message for a person. */
export class SecretSaveError extends Error {
  constructor (status, message) {
    super(message)
    this.name = 'SecretSaveError'
    this.status = status
  }
}

/** The message to show for a refused save. */
export function secret_save_message (status) {
  switch (status) {
    case 0:
      return 'The Cluster Manager did not answer, so the password was not saved. '
        + 'Check your network connection and try again.'
    case 401:
    case 403:
      return 'You don\'t have permission to save secrets on this cluster, so the '
        + 'password was not saved. Ask an administrator for the Manage secrets '
        + 'permission on this cluster.'
    case 404:
      return 'The Cluster Manager doesn\'t know this cluster, so the password '
        + 'was not saved.'
    case 503:
      return 'This cluster hasn\'t reported its sealing certificate yet, so the '
        + 'password was not saved. Check the cluster is running and try again.'
    default:
      return 'The Cluster Manager could not save the password (status '
        + status + '). Try again, and ask an administrator if it keeps failing.'
  }
}

/**
 * Save one key of a sealed secret on an edge cluster. Resolves when the
 * Cluster Manager has saved it and rejects with a SecretSaveError
 * otherwise.
 *
 * @param client     the service client
 * @param cluster    the edge cluster's UUID
 * @param namespace  the cluster's Kubernetes namespace
 * @param name       the secret's name
 * @param key        the key within the secret
 * @param value      the value to seal
 */
export async function save_edge_secret (client, { cluster, namespace, name, key, value }) {
  let res
  try {
    res = await client.Fetch.fetch({
      service: UUIDs.Service.Clusters,
      url: `v1/cluster/${cluster}/secret/${namespace}/${name}/${key}`,
      method: 'PUT',
      body: value,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  }
  catch {
    throw new SecretSaveError(0, secret_save_message(0))
  }

  /* The service client answers a network failure with status 0. */
  const status = res?.status ?? 0
  if (status < 200 || status >= 300)
    throw new SecretSaveError(status, secret_save_message(status))
}

/* Checking before a save whether the signed-in user may save secrets on
 * a cluster, so a dialog can turn its password fields off and say why
 * instead of letting someone type a password that will be refused.
 *
 * The Cluster Manager checks these against the cluster's UUID, with a
 * wildcard grant counting too. Manage secrets allows adding, overwriting
 * and deleting keys. Create secrets allows adding a new key only, which
 * is all the connection dialog needs because every save there uses a
 * fresh random key. */
export const SecretPerm = {
  Manage: '07fba27a-0d01-4c07-875b-d25345261d3a',
  Create: 'a558eb08-e3fc-449f-8492-ae4f2514714b',
}

const WILDCARD = '00000000-0000-0000-0000-000000000000'

/**
 * Whether an ACL lets its principal save secrets on a cluster.
 *
 * The Auth service only returns the entries for permissions the caller
 * may read (Read ACL on that permission), so a missing grant only means
 * "no" when the ACL also shows the caller can read every permission
 * asked about. Anything less is "unknown", and the caller should leave
 * the fields on and rely on the save reporting a refusal.
 *
 * @param acl          the principal's ACL, as [{ permission, target }]
 * @param cluster      the edge cluster's UUID
 * @param permissions  the permissions, any one of which is enough
 * @returns true, false, or null when the ACL can't tell
 */
export function secret_access (acl, cluster, permissions) {
  if (!Array.isArray(acl) || !cluster) return null

  const on = (permission, target) => acl.some(ace =>
    ace.permission === permission
    && (ace.target === target || ace.target === WILDCARD))

  if (permissions.some(p => on(p, cluster))) return true
  if (permissions.every(p => on(UUIDs.Permission.Auth.ReadACL, p))) return false
  return null
}

/**
 * Look up whether the signed-in user may save secrets on a cluster.
 * Reads the user's own ACL from the Auth service in the same way as the
 * rebirth button, but by principal UUID rather than a guessed Kerberos
 * name. Never rejects: any failure, such as a user who can't read their
 * own ACL, gives null.
 *
 * @param client       the service client
 * @param cluster      the edge cluster's UUID
 * @param permissions  the permissions, any one of which is enough
 * @returns true, false, or null when it can't tell
 */
export async function load_secret_access (client, cluster, permissions) {
  try {
    const me = await client.Auth.whoami_uuid()
    const [st, acl] = await client.Auth.fetch(`v2/acl/${me}`)
    if (st !== 200) return null
    return secret_access(acl, cluster, permissions)
  }
  catch (e) {
    console.debug('Could not check permission to save secrets:', e)
    return null
  }
}
