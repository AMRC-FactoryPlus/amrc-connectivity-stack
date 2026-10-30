/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

// Releasing a dataset outside Factory+ as briefcases. The briefcase
// exporter (acs-briefcase) builds a briefcase of each dataset in the
// Published class, and records every briefcase it builds in the
// dataset's Briefcase release entry, oldest first.

import { DA } from './constants.js'

// What each access tier in a release policy means.
export const TIERS = {
    'open':             'Anyone, with no sign-in',
    'registered':       'Any signed-in user who has accepted the licence',
    'approved-project': 'Members of a project approved for this briefcase',
    'enclave-only':     'Approved projects, inside an enclave only',
}

export function is_published (rec) {
    return !!rec?.functions?.includes(DA.Class.Published)
}

/** The dataset's release policy, or null. */
export function release_policy (rec) {
    return rec?.meta?.[DA.App.ReleasePolicy] ?? null
}

/**
 * Where a dataset's release stands, from its Published membership and
 * its Briefcase release entry:
 *  - released:     Published, with a live briefcase
 *  - building:     Published, waiting for the exporter to build one
 *  - withdrawing:  out of Published, waiting for the exporter to
 *                  mark its briefcase withdrawn
 *  - withdrawn:    out of Published, every briefcase withdrawn
 *  - unreleased:   never had a briefcase
 */
export function release_state (rec, entry) {
    const last = entry?.briefcases?.at(-1) ?? null
    const live = last && !last.withdrawn
    if (is_published(rec)) return live ? 'released' : 'building'
    if (live) return 'withdrawing'
    return last ? 'withdrawn' : 'unreleased'
}

/** The dataset's briefcases, newest first, marking the live one. */
export function briefcase_history (entry) {
    const list = entry?.briefcases ?? []
    return list
        .map((b, i) => ({ ...b, live: i === list.length - 1 && !b.withdrawn }))
        .reverse()
}

export function briefcase_file_name (briefcase) {
    return `briefcase-${briefcase.uuid}.zip`
}

/** A size in bytes, in the largest unit that keeps it above 1. */
export function fmt_size (bytes) {
    if (!Number.isFinite(bytes)) return ''
    const units = ['bytes', 'kB', 'MB', 'GB', 'TB']
    let n = bytes
    let u = 0
    while (n >= 1000 && u < units.length - 1) {
        n /= 1000
        u++
    }
    return u === 0 ? `${n} ${units[0]}` : `${n.toFixed(n < 10 ? 1 : 0)} ${units[u]}`
}
