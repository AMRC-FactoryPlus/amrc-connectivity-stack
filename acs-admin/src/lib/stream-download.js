/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Streamed downloads. The console streams big files (dataset CSVs,
 * files from the Files service) to disk with StreamSaver. This module
 * holds the parts that do not need StreamSaver itself, so the unit
 * tests can load it in node: where the helper page lives, and a pipe
 * that gives up when the browser stops taking the data.
 */

/** StreamSaver's helper page, served by the console itself from
 * public/streamsaver/.
 *
 * StreamSaver's default copy is on GitHub Pages. In a secure context
 * StreamSaver loads it in a hidden iframe, and the console's
 * Content-Security-Policy (`frame-src 'self'`) blocks that frame, so
 * the download never starts. The query string is the protocol version
 * StreamSaver 2.0.x expects; the page passes it on to its service
 * worker. See .docker/nginx.conf for the policy this page gets. */
export const MITM_PAGE = '/streamsaver/mitm.html?version=2.0.0'

/** How long one chunk may wait for the browser to take it before the
 * download gives up. A working download takes each chunk at once. A
 * download the browser never started takes none at all. */
export const STALL_TIMEOUT_MS = 30000

export const STALLED_MESSAGE = 'The browser did not start the download. Reload the page and try again.'

/** The browser stopped taking the data, so the download cannot finish. */
export class DownloadStalled extends Error {
    constructor (message = STALLED_MESSAGE) {
        super(message)
        this.name = 'DownloadStalled'
    }
}

/* Settle as `promise` does, or reject with DownloadStalled after `ms`. */
function within (ms, promise) {
    let timer
    const stalled = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new DownloadStalled()), ms)
    })
    return Promise.race([promise, stalled]).finally(() => clearTimeout(timer))
}

/**
 * Copy `readable` into `writable`, as pipeTo does, but reject with
 * DownloadStalled if the writable takes no chunk for `timeout` ms.
 *
 * Only the writable side is timed. A slow source, such as a big query
 * that takes a while to produce its first row, is not a stall. A
 * browser that never opened the file is. StreamSaver's write stream
 * holds almost nothing, so when its helper page did not load, the
 * first write waits for ever.
 *
 * On any failure both ends stop: the request is cancelled, so the
 * server stops sending, and the write stream is aborted, so the
 * browser drops the partial file.
 */
export async function pipe_with_stall_timeout (readable, writable, { timeout = STALL_TIMEOUT_MS } = {}) {
    const reader = readable.getReader()
    const writer = writable.getWriter()
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            await within(timeout, writer.write(value))
        }
        await within(timeout, writer.close())
    }
    catch (err) {
        // Neither is awaited: a write stuck in the sink holds up the abort too.
        reader.cancel(err).catch(() => {})
        writer.abort(err).catch(() => {})
        throw err
    }
}
