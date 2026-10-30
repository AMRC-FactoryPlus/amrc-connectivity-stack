/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Datasets pages: where a dataset's release outside Factory+ stands,
 * from its Published membership and its Briefcase release entry.
 */

import { describe, it, expect } from 'vitest'
import { DA, BRIEFCASE } from '../src/lib/datasets/constants.js'
import {
    is_published, release_policy, release_state, briefcase_history,
    briefcase_file_name, fmt_size, release_blocker,
    policy_form, policy_problems, form_policy,
    release_dataset, withdraw_dataset, save_release_policy,
} from '../src/lib/datasets/release.js'

const OLD = { uuid: '334cde6d-5e20-4cac-ab6d-7d1e14ccee6e', withdrawn: '2026-10-30T13:33:39Z' }
const NEW = { uuid: '4bd9439d-44eb-416d-b15b-6dbc127b24f3', replaces: OLD.uuid }

const published = { functions: [DA.Class.Run, DA.Class.Published] }
const unpublished = { functions: [DA.Class.Run] }

describe('release state', () => {
    it('is released when Published with a live briefcase', () => {
        expect(release_state(published, { briefcases: [OLD, NEW] })).toBe('released')
    })

    it('is building when Published but not yet built', () => {
        expect(release_state(published, null)).toBe('building')
        expect(release_state(published, { briefcases: [OLD] })).toBe('building')
    })

    it('is withdrawing when out of Published with a briefcase still live', () => {
        expect(release_state(unpublished, { briefcases: [OLD, NEW] })).toBe('withdrawing')
    })

    it('is withdrawn once every briefcase is withdrawn', () => {
        expect(release_state(unpublished, { briefcases: [OLD] })).toBe('withdrawn')
    })

    it('is unreleased with no briefcases', () => {
        expect(release_state(unpublished, null)).toBe('unreleased')
        expect(release_state({}, undefined)).toBe('unreleased')
    })
})

describe('briefcase history', () => {
    it('lists the newest first and marks the live one', () => {
        expect(briefcase_history({ briefcases: [OLD, NEW] })).toEqual([
            { ...NEW, live: true, note: null },
            { ...OLD, live: false, note: null },
        ])
    })

    it('has no live briefcase once the last is withdrawn', () => {
        const gone = { ...NEW, withdrawn: '2026-10-30T13:42:36Z' }
        expect(briefcase_history({ briefcases: [OLD, gone] }).map(b => b.live)).toEqual([false, false])
    })

    it('is empty with no entry', () => {
        expect(briefcase_history(null)).toEqual([])
    })
})

describe('release helpers', () => {
    it('reads Published membership and the release policy', () => {
        const policy = { tier: 'open' }
        expect(is_published(published)).toBe(true)
        expect(is_published(unpublished)).toBe(false)
        expect(is_published(null)).toBe(false)
        expect(release_policy({ meta: { [DA.App.ReleasePolicy]: policy } })).toBe(policy)
        expect(release_policy({ meta: {} })).toBeNull()
    })

    it('names the download after the briefcase', () => {
        expect(briefcase_file_name(NEW)).toBe(`briefcase-${NEW.uuid}.zip`)
    })

    it('formats sizes', () => {
        expect(fmt_size(512)).toBe('512 bytes')
        expect(fmt_size(20602)).toBe('21 kB')
        expect(fmt_size(4_800_000_000)).toBe('4.8 GB')
        expect(fmt_size(undefined)).toBe('')
    })
})

describe('withdrawal notes', () => {
    it('go with their briefcase in the history', () => {
        const notes = { [OLD.uuid]: { reason: 'Wrong window', by: 'kp' } }
        const [now, old] = briefcase_history({ briefcases: [OLD, NEW] }, notes)
        expect(old.note).toEqual({ reason: 'Wrong window', by: 'kp' })
        expect(now.note).toBeNull()
    })
})

describe('what blocks a release', () => {
    const ready = { from: '2026-10-30T09:00:00.000Z', to: '2026-10-30T10:00:00.000Z',
        meta: { [DA.App.ReleasePolicy]: { tier: 'open' } } }

    it('is nothing for a bounded dataset with a policy', () => {
        expect(release_blocker(ready)).toBeNull()
    })

    it('is a missing policy, time range or valid structure', () => {
        expect(release_blocker({ ...ready, meta: {} })).toMatch(/release policy/)
        expect(release_blocker({ ...ready, to: null })).toMatch(/start and end/)
        expect(release_blocker({ ...ready, invalid: true })).toMatch(/invalid/)
        expect(release_blocker(null)).toMatch(/not loaded/)
    })
})

describe('the release policy form', () => {
    const POLICY = {
        tier: 'approved-project',
        data_owner: { organisation: 'AMRC', contact: { name: 'Data Owner', email: 'owner@example.ac.uk' } },
        terms: { agreement: 'DSA-2026-014' },
        permitted_use: 'Testing.',
        review_by: '2027-10-30',
    }

    it('round-trips a policy', () => {
        expect(form_policy(policy_form(POLICY))).toEqual(POLICY)
    })

    it('starts a new policy with nothing filled in but the tier', () => {
        const f = policy_form(null)
        expect(f.tier).toBe('approved-project')
        expect(Object.keys(policy_problems(f)).sort())
            .toEqual(['contact_email', 'contact_name', 'organisation', 'permitted_use', 'terms_value'])
    })

    it('trims, and leaves out empty optional fields', () => {
        const f = { ...policy_form(POLICY), organisation: '  AMRC  ', trial: ' ', review_by: '' }
        const p = form_policy(f)
        expect(p.data_owner.organisation).toBe('AMRC')
        expect(p).not.toHaveProperty('trial')
        expect(p).not.toHaveProperty('review_by')
    })

    it('rejects a bad email address or date', () => {
        const f = { ...policy_form(POLICY), contact_email: 'nope', embargo_until: '30/10/2026' }
        expect(Object.keys(policy_problems(f)).sort()).toEqual(['contact_email', 'embargo_until'])
    })
})

/* A ConfigDB stand-in that records each call. A call named in `fail`
 * is refused. */
function fake_client (notes = undefined, fail = null) {
    const calls = []
    const call = (name, ...args) => {
        calls.push([name, ...args])
        if (name === fail) throw Object.assign(new Error('refused'), { status: 403 })
    }
    return {
        calls,
        ConfigDB: {
            get_config: async (...a) => { call('get_config', ...a); return notes },
            put_config: async (...a) => call('put_config', ...a),
            class_add_member: async (...a) => call('class_add_member', ...a),
            class_remove_member: async (...a) => call('class_remove_member', ...a),
        },
    }
}

const DATASET = 'eeeeeeee-0000-4000-8000-000000000001'

describe('releasing and withdrawing', () => {
    it('releases by adding the dataset to Published', async () => {
        const c = fake_client()
        await release_dataset(c, DATASET)
        expect(c.calls).toEqual([['class_add_member', DA.Class.Published, DATASET]])
    })

    it('saves the policy to its app', async () => {
        const c = fake_client()
        await save_release_policy(c, DATASET, { tier: 'open' })
        expect(c.calls).toEqual([['put_config', DA.App.ReleasePolicy, DATASET, { tier: 'open' }]])
    })

    it('saves the reason before leaving Published, keeping earlier notes', async () => {
        const c = fake_client({ [OLD.uuid]: { reason: 'Old' } })
        await withdraw_dataset(c, DATASET, { briefcase: NEW.uuid, reason: 'Wrong window', by: 'kp' })
        expect(c.calls).toEqual([
            ['get_config', BRIEFCASE.App.Notes, DATASET],
            ['put_config', BRIEFCASE.App.Notes, DATASET, {
                [OLD.uuid]: { reason: 'Old' },
                [NEW.uuid]: { reason: 'Wrong window', by: 'kp' },
            }],
            ['class_remove_member', DA.Class.Published, DATASET],
        ])
    })

    it('stays released when the reason cannot be saved', async () => {
        const c = fake_client(undefined, 'put_config')
        await expect(withdraw_dataset(c, DATASET, { briefcase: NEW.uuid, reason: 'x' })).rejects.toThrow('refused')
        expect(c.calls.map(([n]) => n)).not.toContain('class_remove_member')
    })

    it('withdraws with no note when nothing was built yet', async () => {
        const c = fake_client()
        await withdraw_dataset(c, DATASET, { briefcase: null, reason: '' })
        expect(c.calls).toEqual([['class_remove_member', DA.Class.Published, DATASET]])
    })
})
