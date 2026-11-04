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
 * itself.
 *
 * There is no browser here, so these tests pin down the parts that can
 * be checked without one: the helper's address, the helper's files, and
 * the nginx policy they are served under.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

import { MITM_PAGE } from '../src/lib/stream-download.js'

const UPSTREAM_MITM = 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0'

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
