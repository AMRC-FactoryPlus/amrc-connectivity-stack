/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

// Releasing a dataset outside Factory+ as briefcases. The briefcase
// exporter (acs-briefcase) builds a briefcase of each dataset in the
// Published class, and records every briefcase it builds in the
// dataset's Briefcase release entry, oldest first.

import { DA, BRIEFCASE } from './constants.js'

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

/**
 * The dataset's briefcases, newest first, marking the live one. Each
 * carries its note from the Briefcase notes entry, if it has one.
 */
export function briefcase_history (entry, notes = null) {
    const list = entry?.briefcases ?? []
    return list
        .map((b, i) => ({
            ...b,
            live: i === list.length - 1 && !b.withdrawn,
            note: notes?.[b.uuid] ?? null,
        }))
        .reverse()
}

/**
 * Why a dataset can't be released yet, or null if it can. The exporter
 * needs a release policy and a start and end time.
 */
export function release_blocker (rec) {
    if (!rec) return 'The dataset has not loaded.'
    if (rec.invalid) return 'The service reports this dataset as invalid.'
    if (!release_policy(rec)) return 'Give it a release policy first.'
    if (!rec.from || !rec.to) return 'It needs a start and end time.'
    return null
}

/** A release policy as form fields: defaults for a new one. */
export function policy_form (policy) {
    return {
        tier:           policy?.tier ?? 'approved-project',
        organisation:   policy?.data_owner?.organisation ?? '',
        contact_name:   policy?.data_owner?.contact?.name ?? '',
        contact_email:  policy?.data_owner?.contact?.email ?? '',
        terms:          policy?.terms?.agreement ? 'agreement' : 'licence',
        terms_value:    policy?.terms?.agreement ?? policy?.terms?.licence ?? '',
        permitted_use:  policy?.permitted_use ?? '',
        trial:          policy?.trial ?? '',
        embargo_until:  policy?.embargo_until ?? '',
        review_by:      policy?.review_by ?? '',
    }
}

const EMAIL_rx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_rx = /^\d{4}-\d\d-\d\d$/

const text = v => String(v ?? '').trim()

/**
 * What is wrong with a release policy form, by field, in words for
 * the person filling it in. Empty when it can be saved. ConfigDB checks
 * the policy against its schema as well.
 */
export function policy_problems (f) {
    const p = {}
    if (!TIERS[f.tier]) p.tier = 'Choose who may have the data.'
    if (!text(f.organisation)) p.organisation = 'Name the organisation that owns the data.'
    if (!text(f.contact_name)) p.contact_name = 'Name someone to contact about it.'
    if (!EMAIL_rx.test(text(f.contact_email))) p.contact_email = 'Give their email address.'
    if (!text(f.terms_value))
        p.terms_value = f.terms === 'agreement'
            ? 'Give the reference of the data sharing agreement.'
            : 'Give the licence, as an SPDX identifier such as CC-BY-4.0.'
    if (!text(f.permitted_use)) p.permitted_use = 'Say what the data may be used for.'
    for (const k of ['embargo_until', 'review_by'])
        if (text(f[k]) && !DATE_rx.test(text(f[k]))) p[k] = 'Give a date.'
    return p
}

/** The release policy a form describes. Empty optional fields are left out. */
export function form_policy (f) {
    const policy = {
        tier: f.tier,
        data_owner: {
            organisation: text(f.organisation),
            contact: { name: text(f.contact_name), email: text(f.contact_email) },
        },
        terms: f.terms === 'agreement'
            ? { agreement: text(f.terms_value) }
            : { licence: text(f.terms_value) },
        permitted_use: text(f.permitted_use),
    }
    for (const k of ['trial', 'embargo_until', 'review_by'])
        if (text(f[k])) policy[k] = text(f[k])
    return policy
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

/* ------------------------------------------------------------------
 * Writes. Each takes the service client.
 * ------------------------------------------------------------------ */

export async function save_release_policy (client, uuid, policy) {
    await client.ConfigDB.put_config(DA.App.ReleasePolicy, uuid, policy)
}

/** Release a dataset. The briefcase exporter builds a briefcase of
 * every dataset in Published. */
export async function release_dataset (client, uuid) {
    await client.ConfigDB.class_add_member(DA.Class.Published, uuid)
}

/**
 * Withdraw a dataset. The reason goes against its live briefcase
 * first, so a refusal there leaves the dataset released rather than
 * withdrawn with no reason. Then the dataset leaves Published, and the
 * exporter marks the briefcase withdrawn.
 *
 * @param opts.briefcase The live briefcase's UUID, if it has one yet.
 */
export async function withdraw_dataset (client, uuid, { briefcase, reason, by }) {
    if (briefcase) {
        const notes = await client.ConfigDB.get_config(BRIEFCASE.App.Notes, uuid) ?? {}
        notes[briefcase] = by ? { reason, by } : { reason }
        await client.ConfigDB.put_config(BRIEFCASE.App.Notes, uuid, notes)
    }
    await client.ConfigDB.class_remove_member(DA.Class.Published, uuid)
}
