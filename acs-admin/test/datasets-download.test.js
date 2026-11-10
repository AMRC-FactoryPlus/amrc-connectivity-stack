/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Dataset downloads: what a failed download tells the person. Data
 * Access answers a refusal with a JSON body, either `{ error, message }`
 * (a code and its words) or the older `{ error }` (words alone).
 */

import { describe, it, expect } from 'vitest'
import { fetch_csv } from '../src/lib/datasets/api.js'

const DS = 'dddddddd-0000-4000-8000-000000000001'

const answers = (st, text) => ({
    DataAccess: { fetch: async () => [st, new Response(text).body, null, new Headers()] },
})

describe('a failed download', () => {
    it('says why when the site has no UNS bucket', async () => {
        const body = { error: 'uns_unavailable', message: 'This dataset reads the UNS, and this site has no UNS bucket configured.' }
        await expect(fetch_csv(answers(503, JSON.stringify(body)), DS))
            .rejects.toMatchObject({ status: 503, message: body.message })
    })

    it('shows the words of a refusal with a code, not the code', async () => {
        const body = { error: 'window_required', message: 'Give a time window.' }
        await expect(fetch_csv(answers(422, JSON.stringify(body)), DS))
            .rejects.toMatchObject({ status: 422, message: 'Give a time window.' })
    })

    it('still shows an older refusal that has only the words', async () => {
        await expect(fetch_csv(answers(422, JSON.stringify({ error: 'The window is empty.' })), DS))
            .rejects.toMatchObject({ message: 'The window is empty.' })
    })

    it('falls back to the status when the body is not a refusal', async () => {
        await expect(fetch_csv(answers(502, '<html>Bad Gateway</html>'), DS))
            .rejects.toMatchObject({ status: 502, message: 'The download failed (HTTP 502).' })
        await expect(fetch_csv(answers(422, ''), DS))
            .rejects.toMatchObject({ message: 'The service refused the download.' })
    })

    it('keeps its own words for no permission', async () => {
        await expect(fetch_csv(answers(403, '{"message":"x"}'), DS))
            .rejects.toMatchObject({ status: 403, message: 'You do not have permission to read this dataset.' })
    })

    it('returns the CSV when the service answers 200', async () => {
        expect(await fetch_csv(answers(200, 'a,b\n1,2\n'), DS)).toBe('a,b\n1,2\n')
    })
})
