/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/**
 * Datasets pages: where a dataset's release outside Factory+ stands,
 * from its Published membership and its Briefcase release entry.
 */

import { describe, it, expect } from 'vitest'
import { DA } from '../src/lib/datasets/constants.js'
import {
    is_published, release_policy, release_state, briefcase_history,
    briefcase_file_name, fmt_size,
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
            { ...NEW, live: true },
            { ...OLD, live: false },
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
