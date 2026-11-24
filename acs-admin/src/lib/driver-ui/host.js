/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The Manager's side of the driver custom UI exchange.
 *
 * DriverCustomUI.vue owns the iframe and hands every message from it to
 * this controller, which decides what to answer. Keeping it out of the
 * component means the jsdom test drives the real exchange with the real
 * shell page and a real driver document.
 *
 * Shell messages (`host-ready`, `host-failed`) always come in envelope
 * version 1, because public/driver-ui/host.html speaks only that. Messages
 * from the driver's document must come in the version its DriverDef
 * declared, and the controller answers in that version.
 */

import {
  CONTRACT_VERSION,
  SCOUT_VERSION,
  build_document_message,
  build_init,
  build_picked,
  build_scout_changed,
  build_scout_items,
  message_version,
  parse_message,
  validate_proposal,
} from './contract.js'
import { query_items, share_item } from '../scout/model.js'

const SHELL_TYPES = new Set(['host-ready', 'host-failed'])

/* After the operator closes the picker without choosing, a document must
 * wait this long before it can open it again. A request in that time is
 * answered with no item, after REFUSE_DELAY_MS so a document that asks
 * again on every answer cannot spin, and starts the wait again. So a
 * document that keeps asking never reopens the picker, and the operator
 * can always reach the editor. Events inside the sandboxed frame never
 * reach the host, so it cannot tell whether the operator asked. */
export const PICK_COOLDOWN_MS = 3000
export const REFUSE_DELAY_MS = 1000

/**
 * @param {object} opts
 * @param {function} opts.post Posts a message into the frame.
 * @param {string} opts.document The driver's HTML document.
 * @param {number} opts.version The document's contract version.
 * @param {function} opts.init_values Returns `{config, config_schema,
 *   metric, allowed_types}` for `build_init`.
 * @param {object} [opts.scout] Edge Scout access for version 2:
 *   `summary()`, `index()` and `pick(filter)` returning a Promise of an
 *   item or null. Null when the panel is hidden.
 * @param {boolean} [opts.share_samples] DriverDef `scout.share_samples`.
 * @param {object} opts.on Callbacks: `ready`, `failed(reason)`,
 *   `resize(height)`, `propose(values)`, `problems(list)`.
 * @param {function} [opts.now] The clock, for tests.
 * @param {function} [opts.set_timeout] The timer, for tests.
 */
export function create_host ({
  post, document, version, init_values, scout = null, share_samples = false, on,
  now = () => Date.now(), set_timeout = (fn, ms) => setTimeout(fn, ms),
}) {
  let picking = false
  let quiet_until = 0
  let refusing = false

  const answer_pick = async (filter) => {
    if (picking) {
      post(build_picked(null))
      return
    }
    if (now() < quiet_until) {
      quiet_until = now() + PICK_COOLDOWN_MS
      /* One refusal at a time. Requests while one is waiting share it. */
      if (refusing) return
      refusing = true
      set_timeout(() => {
        refusing = false
        post(build_picked(null))
      }, REFUSE_DELAY_MS)
      return
    }
    if (!scout?.index()) {
      post(build_picked(null))
      return
    }
    picking = true
    let item = null
    try {
      item = await scout.pick(filter)
    }
    catch {
      item = null
    }
    finally {
      picking = false
    }
    if (!item) quiet_until = now() + PICK_COOLDOWN_MS
    post(build_picked(item ? share_item(item, share_samples) : null))
  }

  function handle (data) {
    const msg = parse_message(data)
    if (!msg) return
    const v = message_version(data)
    /* The shell speaks version 1. The document speaks its own version,
     * and anything else claiming to be it is ignored. */
    if (SHELL_TYPES.has(msg.type) ? v !== CONTRACT_VERSION : v !== version) return

    switch (msg.type) {
      case 'host-ready':
        post(build_document_message(document))
        break
      case 'host-failed':
        on.failed?.(msg.reason)
        break
      case 'ready':
        on.ready?.()
        post(build_init({
          ...init_values(),
          version,
          scout: version >= SCOUT_VERSION ? scout?.summary() : undefined,
        }))
        break
      case 'resize':
        on.resize?.(msg.height)
        break
      case 'propose': {
        const { allowed_types } = init_values()
        const { values, errors } = validate_proposal(msg.values, { allowed_types })
        on.problems?.(errors)
        if (Object.keys(values).length) on.propose?.(values)
        break
      }
      case 'pick-address':
        answer_pick(msg.filter)
        break
      case 'scout-query':
        post(build_scout_items(query_items(scout?.index(), {
          prefix: msg.prefix, limit: msg.limit, share_samples,
        })))
        break
    }
  }

  /** Tell a version 2 document that the scan state changed. */
  function scout_changed (summary) {
    if (version >= SCOUT_VERSION) post(build_scout_changed(summary))
  }

  return { handle, scout_changed, get picking () { return picking } }
}
