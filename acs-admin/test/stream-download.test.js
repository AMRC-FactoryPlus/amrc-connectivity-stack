/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Streamed downloads.
 *
 * Dataset CSV and file downloads spun forever on HTTPS sites. StreamSaver
 * loaded its helper page in an iframe from GitHub Pages, the console's
 * CSP (frame-src 'self') blocked the frame, and the first write into
 * StreamSaver's stream never returned. The console now serves the helper
 * itself, and a download that the browser never takes gives up with a
 * message instead.
 *
 * There is no browser here, so these tests pin down the parts that can
 * be checked without one: the pipe and its timeout, the helper's address,
 * the helper's files, and the nginx policy they are served under.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

import {
    MITM_PAGE,
    STALL_TIMEOUT_MS,
    STALLED_MESSAGE,
    DownloadStalled,
    pipe_with_stall_timeout,
} from '../src/lib/stream-download.js'

const UPSTREAM_MITM = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0'

const enc = new TextEncoder()
const dec = new TextDecoder()

function source_of (...chunks) {
    return new ReadableStream({
        start (c) {
            for (const ch of chunks) c.enqueue(enc.encode(ch))
            c.close()
        },
    })
}

/* A source that never runs out, and records being cancelled. */
function endless_source () {
    const cancelled = vi.fn()
    const stream = new ReadableStream({
        pull (c) { c.enqueue(enc.encode('t,v\n')) },
        cancel: cancelled,
    })
    return { stream, cancelled }
}

function collecting_sink () {
    const chunks = []
    const closed = vi.fn()
    const stream = new WritableStream({
        write (chunk) { chunks.push(chunk) },
        close: closed,
    })
    return { stream, chunks, closed, text: () => chunks.map(c => dec.decode(c, { stream: true })).join('') }
}

/* Track a promise without awaiting it, so a test can ask if it settled yet. */
function track (promise) {
    const state = { settled: false }
    promise.then(() => { state.settled = true }, () => { state.settled = true })
    return state
}

afterEach(() => {
    vi.useRealTimers()
})

describe('pipe_with_stall_timeout', () => {
    it('copies every byte, in order, and closes the sink', async () => {
        const sink = collecting_sink()
        const csv = ['timestamp,device,metric,value\n', '2026-01-01T00:00:00Z,a,b,1\n', '2026-01-01T00:00:01Z,a,b,2\n']

        await pipe_with_stall_timeout(source_of(...csv), sink.stream)

        expect(sink.chunks).toHaveLength(3)
        expect(sink.text()).toEqual(csv.join(''))
        expect(sink.closed).toHaveBeenCalledOnce()
    })

    it('passes binary chunks through unchanged', async () => {
        const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
        const sink = collecting_sink()
        const src = new ReadableStream({ start (c) { c.enqueue(bytes); c.close() } })

        await pipe_with_stall_timeout(src, sink.stream)

        expect(sink.chunks).toEqual([bytes])
    })

    it('gives up when the sink never takes a chunk', async () => {
        vi.useFakeTimers()
        const src = endless_source()
        const sink = new WritableStream({ write: () => new Promise(() => {}) })

        const done = pipe_with_stall_timeout(src.stream, sink)
        const state = track(done)

        await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 1)
        expect(state.settled).toBe(false)

        await vi.advanceTimersByTimeAsync(1)
        await expect(done).rejects.toBeInstanceOf(DownloadStalled)
        await expect(done).rejects.toThrow(STALLED_MESSAGE)
        // The request is cancelled, so the server stops sending.
        expect(src.cancelled).toHaveBeenCalledOnce()
    })

    it('gives up on a StreamSaver-shaped sink whose reader never loaded', async () => {
        vi.useFakeTimers()
        // createWriteStream returns the writable side of a TransformStream
        // and hands the readable side to the helper page. With the helper
        // blocked, nothing ever reads it.
        const { writable } = new TransformStream()

        const done = pipe_with_stall_timeout(source_of('t,v\n', '1,2\n'), writable, { timeout: 5000 })
        track(done)

        await vi.advanceTimersByTimeAsync(5000)
        await expect(done).rejects.toBeInstanceOf(DownloadStalled)
    })

    it('honours a shorter timeout', async () => {
        vi.useFakeTimers()
        const sink = new WritableStream({ write: () => new Promise(() => {}) })

        const done = pipe_with_stall_timeout(endless_source().stream, sink, { timeout: 1000 })
        const state = track(done)

        await vi.advanceTimersByTimeAsync(999)
        expect(state.settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await expect(done).rejects.toBeInstanceOf(DownloadStalled)
    })

    it('waits as long as it takes for a slow source', async () => {
        vi.useFakeTimers()
        // A big query can take longer than the timeout to produce each
        // row. That is not the browser failing to take the data.
        let rows = 0
        const src = new ReadableStream({
            async pull (c) {
                await new Promise(r => setTimeout(r, STALL_TIMEOUT_MS * 2))
                if (rows++ < 2) c.enqueue(enc.encode(`row ${rows}\n`))
                else c.close()
            },
        })
        const sink = collecting_sink()

        const done = pipe_with_stall_timeout(src, sink.stream)
        track(done)

        await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 7)
        await expect(done).resolves.toBeUndefined()
        expect(sink.text()).toEqual('row 1\nrow 2\n')
    })

    it('passes a source error on as it is and aborts the sink', async () => {
        const boom = new Error('The connection was reset.')
        let sent = false
        const src = new ReadableStream({
            pull (c) {
                if (sent) return c.error(boom)
                sent = true
                c.enqueue(enc.encode('t,v\n'))
            },
        })
        const aborted = vi.fn()
        const sink = new WritableStream({ write () {}, abort: aborted })

        await expect(pipe_with_stall_timeout(src, sink)).rejects.toBe(boom)
        await vi.waitFor(() => expect(aborted).toHaveBeenCalledWith(boom))
    })

    it('says what to do in plain words', () => {
        expect(new DownloadStalled().message).toEqual('The browser did not start the download. Reload the page and try again.')
        expect(STALL_TIMEOUT_MS).toBeGreaterThanOrEqual(10000)
    })
})

describe('the StreamSaver helper page', () => {
    const dir = new URL('../public/streamsaver/', import.meta.url)
    const read = f => readFileSync(new URL(f, dir), 'utf-8')

    it('is on the console\'s own origin', () => {
        const origin = 'https://admin.example.test'
        const url = new URL(MITM_PAGE, `${origin}/#/datasets/1234`)

        expect(url.origin).toEqual(origin)
        expect(url.pathname).toEqual('/streamsaver/mitm.html')
        expect(url.searchParams.get('version')).toEqual('2.0.0')
        expect(existsSync(new URL(`../public${url.pathname}`, import.meta.url))).toBe(true)
    })

    it('ships with its script, worker and licence', () => {
        for (const f of ['mitm.html', 'mitm.js', 'sw.js', 'LICENSE'])
            expect(existsSync(new URL(f, dir)), f).toBe(true)
    })

    it('has no inline script, which the CSP would block', () => {
        const html = read('mitm.html').replace(/<!--[\s\S]*?-->/g, '')
        const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]

        expect(scripts).toHaveLength(1)
        const [, attrs, body] = scripts[0]
        expect(attrs).toMatch(/\bsrc="mitm\.js"/)
        expect(body.trim()).toEqual('')
        expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    })

    it('registers its worker for /streamsaver/ only', () => {
        // sw.js sits next to mitm.html, so scope './' is /streamsaver/.
        expect(read('mitm.js')).toContain("navigator.serviceWorker.register('sw.js', { scope: './' })")
    })
})

describe('the nginx policy for the helper', () => {
    const conf = readFileSync(new URL('../.docker/nginx.conf', import.meta.url), 'utf-8')

    function location (prefix) {
        const at = conf.indexOf(`location ${prefix} {`)
        expect(at, `location ${prefix}`).toBeGreaterThan(-1)
        return conf.slice(at, conf.indexOf('}', at))
    }

    function csp (block) {
        const m = /add_header Content-Security-Policy "([^"]+)"/.exec(block)
        expect(m).not.toBeNull()
        return Object.fromEntries(m[1].split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))
    }

    it('lets the console frame the helper and the helper run its worker', () => {
        const block = location('^~ /streamsaver/')
        const policy = csp(block)

        expect(policy['frame-ancestors']).toEqual(["'self'"])
        expect(policy['script-src']).toEqual(["'self'"])
        expect(policy['worker-src']).toEqual(["'self'"])
        expect(policy['connect-src']).toEqual(["'self'"])
        expect(block).toMatch(/X-Content-Type-Options "nosniff"/)
        // A download URL no worker answers must not get index.html.
        expect(block).toMatch(/try_files \$uri =404;/)
    })

    it('lets the console load frames from its own origin', () => {
        expect(csp(location('/'))['frame-src']).toContain("'self'")
    })
})

describe('the configured StreamSaver', () => {
    /* Just enough of a browser main thread for StreamSaver to load. The
     * streamsaver module itself may be loaded once and shared between
     * tests, so each test resets the helper address before reloading
     * the console's module. */
    async function configured ({ secure }) {
        vi.stubGlobal('window', globalThis)
        vi.stubGlobal('HTMLElement', class HTMLElement {})
        vi.stubGlobal('document', { documentElement: { style: {} } })
        vi.stubGlobal('isSecureContext', secure)
        const { default: upstream } = await import('streamsaver')
        upstream.mitm = UPSTREAM_MITM
        vi.resetModules()
        const { default: ss } = await import('../src/lib/stream-saver.js')
        return ss
    }

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('uses the console\'s own helper in a secure context', async () => {
        expect((await configured({ secure: true })).mitm).toEqual(MITM_PAGE)
    })

    it('keeps StreamSaver\'s own helper on plain HTTP', async () => {
        expect((await configured({ secure: false })).mitm).toEqual(UPSTREAM_MITM)
    })
})
