/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { ref, computed, watch } from 'vue'
import {
  delete_plan, helper_owner, owner_of_helper, delete_in_order, dataset_exists, remaining_referrers,
} from '@/lib/datasets/api.js'
import { display_name } from '@/lib/datasets/model.js'

/**
 * What DeleteDatasetDialog does, without the dialog, so it can be
 * tested against a real store.
 *
 * - A session over its own "<name> (devices)" union deletes the
 *   session, then the union. Opening the union offers both, session
 *   first; nothing is sent until the person chooses.
 * - A refusal lists the referrers still holding the dataset back,
 *   rebuilt from the store: one deleted elsewhere drops out. When none
 *   are left it tries again by itself, with backoff while the service
 *   catches up.
 * - Every request times out, and busy and waiting always clear.
 *
 * @param ds        the datasets store (or anything with `byUuid`)
 * @param client    a function returning the service client
 * @param notify    { deleted(uuid), success(text), failure(title, text) }
 * @param options   passed to delete_in_order (waits and timeouts, for tests)
 */
export function createDeleteFlow ({ ds, client, notify = {}, options = {} }) {
  const target = ref(null)
  const referrers = ref(null)
  const error = ref(null)
  const busy = ref(false)
  const waiting = ref(false)
  const waitingText = ref('')
  // Referrers known to be gone: deleted here, or 404 from the service.
  const gone = ref([])
  // Referrers that were in the store when the service refused.
  const seen = ref([])
  // The session whose device list the target is, kept as found so the
  // offer stays while the store catches up with a delete.
  const owner = ref(null)

  const byUuid = () => ds.byUuid ?? {}
  const name = computed(() => display_name(target.value))
  const ownerName = computed(() => display_name(owner.value))
  const plan = computed(() => target.value ? delete_plan(target.value, byUuid()) : { order: [], helper: null })
  const helperName = computed(() => display_name(plan.value.helper))
  const remaining = computed(() => remaining_referrers(referrers.value, { gone: gone.value, seen: seen.value, byUuid: byUuid() }))
  const blocked = computed(() => remaining.value.length > 0)

  const log = (...args) => {
    if (import.meta.env?.DEV) console.debug('Datasets delete:', ...args)
  }

  // Bumped when the dialog opens or closes, and for each run, so an
  // old run cannot change what the dialog shows.
  let runId = 0
  // Whether a retry has started by itself since the last refusal.
  let autoTried = false

  function open (record) {
    runId++
    target.value = record
    referrers.value = null
    error.value = null
    busy.value = false
    waiting.value = false
    gone.value = []
    seen.value = []
    autoTried = false
    owner.value = owner_of_helper(record, byUuid())
  }

  function close () {
    runId++
    busy.value = false
    waiting.value = false
    target.value = null
  }

  const why = res => res.timedOut ? res.reason
    : res.referrers ? 'other datasets include it'
    : (res.reason ?? 'the service refused')

  // A refusal: keep what holds this back, as the store shows it now.
  function refused (res) {
    seen.value = res.referrers.filter(r => byUuid()[r])
    referrers.value = res.referrers
  }

  async function run (order, helperUuid = null) {
    const my = ++runId
    const c = client()
    busy.value = true
    error.value = null
    try {
      const res = await delete_in_order(c, order, {
        ...options,
        log,
        onWait: uuid => {
          if (my !== runId) return
          waitingText.value = uuid === helperUuid ? 'Deleting the device list...' : 'Waiting for the service to catch up...'
          waiting.value = true
        },
        gone: async r => gone.value.includes(r)
          || (seen.value.includes(r) && !byUuid()[r])
          || (!byUuid()[r] && !await dataset_exists(c, r)),
        cancelled: () => my !== runId,
      })
      if (my !== runId) return null
      gone.value = [...new Set([...gone.value, ...res.deleted, ...(res.gone ?? [])])]
      return res
    }
    catch (err) {
      log('failed', err)
      if (my === runId) error.value = err?.message ?? 'The delete failed.'
      return null
    }
    finally {
      if (my === runId) {
        busy.value = false
        waiting.value = false
      }
    }
  }

  async function confirm () {
    const rec = target.value
    if (!rec || busy.value) return
    const helper = plan.value.helper
    const res = await run(plan.value.order, helper?.uuid ?? null)
    if (!res) return
    if (res.ok) {
      notify.success?.(helper ? 'Dataset and its device list deleted' : 'Dataset deleted')
      notify.deleted?.(rec.uuid)
      close()
    }
    else if (res.deleted.includes(rec.uuid)) {
      // The dataset went but its device list did not.
      notify.failure?.('Device list not deleted',
        `"${display_name(rec)}" is deleted. Its device list, "${display_name(helper)}", is not: ${why(res)}.`)
      notify.deleted?.(rec.uuid)
      close()
    }
    else if (res.referrers) {
      refused(res)
      owner.value = helper_owner(rec, res.referrers, byUuid())
      if (!blocked.value) error.value = 'The service still lists deleted datasets as using this one. Try again in a moment.'
    }
    else error.value = res.reason
  }

  /* Try again by hand: start afresh from the store. */
  function retry () {
    referrers.value = null
    seen.value = []
    autoTried = false
    return confirm()
  }

  async function deleteWithOwner () {
    const rec = target.value
    const first = owner.value
    if (!rec || !first || busy.value) return
    const res = await run([first.uuid, rec.uuid], rec.uuid)
    if (!res) return
    if (res.ok) {
      notify.success?.('Both datasets deleted')
      notify.deleted?.(rec.uuid)
      close()
    }
    else if (res.deleted.includes(first.uuid)) {
      owner.value = null
      error.value = `"${display_name(first)}" is deleted. "${display_name(rec)}" is not: ${why(res)}.`
      if (res.referrers) refused(res)
    }
    else error.value = `Nothing was deleted. "${display_name(first)}" could not be deleted: ${why(res)}.`
  }

  // Once every referrer has gone (deleted here or elsewhere), try again
  // by itself, once per refusal.
  watch(() => !!referrers.value?.length && !blocked.value && !!target.value, free => {
    if (!free || busy.value || autoTried) return
    autoTried = true
    log('every referrer has gone, trying again')
    confirm()
  })

  return {
    target, referrers, error, busy, waiting, waitingText, gone, owner,
    name, ownerName, plan, helperName, remaining, blocked,
    open, close, confirm, retry, deleteWithOwner,
  }
}
