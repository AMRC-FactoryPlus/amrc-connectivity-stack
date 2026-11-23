/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Saving a value into an edge cluster's sealed secret.
 *
 * The Cluster Manager seals the value with the cluster's kubeseal
 * certificate and commits it to the cluster's Git repo, and Flux then
 * applies it on the edge. Its answers (acs-cluster-manager
 * lib/edge-deploy.js and lib/secrets.js) are 204 when saved, 403 without
 * permission to save secrets on the cluster, 404 for a cluster it
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

/** The message to show for a refused save. `permission` names the
 * permission to ask for on a 401 or 403. */
export function secret_save_message (status, permission = 'Create secrets') {
  switch (status) {
    case 0:
      return 'The Cluster Manager did not answer, so the password was not saved. '
        + 'Check your network connection and try again.'
    case 401:
    case 403:
      return 'You don\'t have permission to save secrets on this cluster, so the '
        + 'password was not saved. Ask an administrator for the ' + permission
        + ' permission on this cluster.'
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
 * @param permission the permission a refusal asks for: Create secrets
 *                   to add a new key, Manage secrets to overwrite one
 */
export async function save_edge_secret (client, {
  cluster, namespace, name, key, value, permission = 'Create secrets',
}) {
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
    throw new SecretSaveError(0, secret_save_message(0, permission))
  }

  /* The service client answers a network failure with status 0. */
  const status = res?.status ?? 0
  if (status < 200 || status >= 300)
    throw new SecretSaveError(status, secret_save_message(status, permission))
}

/* Checking before a save whether the signed-in user may save secrets on
 * a cluster, so a dialog can turn its password fields off and say why
 * instead of letting someone type a password that will be refused.
 *
 * The Cluster Manager answers GET v1/cluster/:cluster/secret-access with
 * { manage, create } for the caller. manage is the Manage secrets
 * permission, which allows adding, overwriting and deleting keys.
 * create is true when the caller can add a new key, which Create
 * secrets or Manage secrets allows, and is all the connection dialog
 * needs because every save there uses a fresh random key. */

/**
 * Turn the Cluster Manager's answer into true, false, or null when it
 * can't tell. A Cluster Manager without the route answers 404, and that
 * or any other failure is null, so the caller leaves the fields on and
 * relies on the save reporting a refusal.
 *
 * @param status  the HTTP status, 0 for no answer
 * @param body    the parsed JSON body
 * @param need    'create' to add a new key, 'manage' to overwrite one
 */
export function secret_access (status, body, need) {
  if (status !== 200) return null
  const answer = body?.[need]
  return typeof answer === 'boolean' ? answer : null
}

/**
 * Ask the Cluster Manager whether the signed-in user may save secrets on
 * a cluster. Never rejects: any failure gives null.
 *
 * @param client   the service client
 * @param cluster  the edge cluster's UUID
 * @param need     'create' or 'manage', as for secret_access
 * @returns true, false, or null when it can't tell
 */
export async function load_secret_access (client, cluster, need) {
  if (!cluster) return null
  try {
    const res = await client.Fetch.fetch({
      service: UUIDs.Service.Clusters,
      url: `v1/cluster/${cluster}/secret-access`,
    })
    const status = res?.status ?? 0
    const body = status === 200 ? await res.json() : null
    return secret_access(status, body, need)
  }
  catch (e) {
    console.debug('Could not check permission to save secrets:', e)
    return null
  }
}
