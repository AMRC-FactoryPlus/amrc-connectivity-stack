/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Fetch an Edge Scout snapshot from the Files service and read it.
 *
 * A snapshot can hold 50,000 items and run to tens of megabytes once
 * decompressed, so gunzip, NDJSON parsing and indexing happen in a
 * worker. The page fetches the gzipped bytes with its own authenticated
 * client and transfers them in, so no credentials reach the worker.
 */

import { build_index, decode_snapshot } from './snapshot.js'
/* The worker is snapshot.js itself, as source text, with a message
 * handler added and run from a blob URL (the console's CSP allows
 * `worker-src blob:`). snapshot.js imports nothing, so it runs as it is.
 * A bundled worker (`new Worker(new URL(...))`) made Vite build a second
 * copy of the app's plugins and pushed the production build past Node's
 * default heap. */
import snapshot_source from './snapshot.js?raw'

export const WORKER_SOURCE = `${snapshot_source}
self.onmessage = async (event) => {
  const { id, bytes } = event.data ?? {}
  try {
    const snap = await decode_snapshot(bytes)
    const index = snap.valid ? build_index(snap.items) : null
    self.postMessage({ id, ok: true, snapshot: { ...snap, index } })
  }
  catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) })
  }
}
`

let worker = null
let next_id = 0
const waiting = new Map()

function get_worker () {
  if (worker || typeof Worker === 'undefined') return worker
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
  worker = new Worker(url, { type: 'module' })
  worker.onmessage = (event) => {
    const { id, ok, snapshot, error } = event.data
    const w = waiting.get(id)
    if (!w) return
    waiting.delete(id)
    ok ? w.resolve(snapshot) : w.reject(new Error(error))
  }
  worker.onerror = (event) => {
    for (const w of waiting.values()) w.reject(new Error(event.message || 'The snapshot worker failed'))
    waiting.clear()
    worker = null
  }
  return worker
}

/**
 * Read gzipped snapshot bytes, in the worker where there is one.
 *
 * @param {ArrayBuffer} bytes
 * @returns {Promise<object>} The parse result from `parse_snapshot`, with
 *   `index` from `build_index` when it is valid.
 */
export async function read_snapshot (bytes) {
  const w = get_worker()
  if (!w) {
    const snap = await decode_snapshot(bytes)
    return { ...snap, index: snap.valid ? build_index(snap.items) : null }
  }
  const id = ++next_id
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({ id, bytes }, [bytes])
  })
}

/**
 * Download a snapshot File object and read it.
 *
 * @param {object} client The service client.
 * @param {string} file The snapshot's File UUID.
 * @returns {Promise<object>} As `read_snapshot`.
 */
export async function load_snapshot (client, file) {
  const body = await client.Files.get_file_stream(file)
  if (!body) throw new Error('The snapshot file is missing from the Files service.')
  const bytes = await new Response(body).arrayBuffer()
  return read_snapshot(bytes)
}
