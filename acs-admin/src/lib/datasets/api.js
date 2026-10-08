/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Actions for the Datasets pages. Every call runs as the signed-in
 * user. Nothing here retries a write silently: on failure it throws,
 * and the page shows that nothing (or what) was saved.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { DA, STRUCTURE, KIND_BY_ID } from './constants.js'
import { to_iso, validate_window, device_dataset_for, direct_sources, normalise_tags } from './model.js'
import { parse_series, series_error } from './series.js'

/** An error a page can show as it is. */
export class DatasetError extends Error {
    constructor (message, { status, detail, saved } = {}) {
        super(message)
        this.status = status
        this.detail = detail
        // What did get saved before the failure, so the page can say so.
        this.saved = saved ?? []
    }
}

function why (err) {
    const st = err?.status
    if (st === 403) return 'You do not have permission for this.'
    if (st === 409) return 'Another dataset includes this one.'
    if (st === 422) return 'The service refused the definition.'
    return err?.message ?? 'Something went wrong.'
}

/* ------------------------------------------------------------------
 * Small writes
 * ------------------------------------------------------------------ */

/**
 * A conditional ConfigDB write. `ifMatch: '*'` writes only if the entry
 * exists, `ifNoneMatch: '*'` only if it does not. Returns the status.
 */
async function cdb_write (client, { method, app, obj, body, merge = false, ifMatch, ifNoneMatch }) {
    const headers = {}
    if (ifMatch) headers['If-Match'] = ifMatch
    if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch
    const [st] = await client.ConfigDB.fetch({
        method,
        url: `/v2/app/${app}/object/${obj}`,
        body,
        headers,
        ...(merge ? { content_type: 'application/merge-patch+json' } : {}),
    })
    return st
}

function cdb_fail (what, st) {
    const err = new DatasetError(what, { status: st, detail: why({ status: st }) })
    return err
}

/** The top-level keys of `next` that differ from `prev`, as a merge patch. */
export function merge_patch_of (prev, next) {
    const patch = {}
    for (const k of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) {
        const a = prev?.[k], b = next?.[k]
        if (JSON.stringify(a) !== JSON.stringify(b)) patch[k] = b === undefined ? null : b
    }
    return patch
}

export async function set_name (client, uuid, name) {
    // Keep any other fields in the Info entry.
    const current = await client.ConfigDB.get_config(UUIDs.App.Info, uuid) ?? {}
    if (current.name === name) return
    await client.ConfigDB.put_config(UUIDs.App.Info, uuid, { ...current, name })
}

export async function set_tags (client, uuid, tags) {
    const clean = normalise_tags(tags)
    if (clean.length) await client.ConfigDB.put_config(DA.App.Tags, uuid, { tags: clean })
    else await delete_quietly(client, DA.App.Tags, uuid)
}

export async function set_labels (client, uuid, labels) {
    const clean = Object.fromEntries(Object.entries(labels ?? {})
        .map(([k, v]) => [k, (v ?? '').trim()])
        .filter(([, v]) => v))
    if (Object.keys(clean).length) await client.ConfigDB.put_config(DA.App.EquipmentLabels, uuid, { labels: clean })
    else await delete_quietly(client, DA.App.EquipmentLabels, uuid)
}

/** Read, change and write run metadata. `change` gets a copy. */
export async function update_run_meta (client, uuid, change) {
    const current = await client.ConfigDB.get_config(DA.App.RunMetadata, uuid) ?? {}
    const next = change(structuredClone(current)) ?? current
    // Send only what changed, so two edits to different fields both stick.
    const patch = merge_patch_of(current, next)
    if (!Object.keys(patch).length) return current
    const st = await cdb_write(client, { method: 'PATCH', app: DA.App.RunMetadata, obj: uuid, body: patch, merge: true })
    if (st !== 204) throw cdb_fail('The details were not saved.', st)
    return next
}

export async function set_kind (client, uuid, kind, previous = null) {
    if (previous && previous !== kind && KIND_BY_ID[previous]) {
        await client.ConfigDB.class_remove_member(KIND_BY_ID[previous].klass, uuid)
    }
    if (kind && KIND_BY_ID[kind] && kind !== previous) {
        await client.ConfigDB.class_add_member(KIND_BY_ID[kind].klass, uuid)
    }
}

async function delete_quietly (client, app, uuid) {
    try { await client.ConfigDB.delete_config(app, uuid) }
    catch (e) { if (e?.status !== 404) throw e }
}

/* ------------------------------------------------------------------
 * Device datasets
 * ------------------------------------------------------------------ */

/**
 * Make sure each device has a device dataset, creating missing ones
 * with the device's name. Returns { [device uuid]: dataset uuid }.
 */
export async function ensure_device_datasets (client, devices, byUuid, nameOf = () => null) {
    const out = {}
    for (const dev of devices) {
        const existing = device_dataset_for(dev, byUuid)
        if (existing) { out[dev] = existing; continue }
        const uuid = await client.DataAccess.create_dataset(STRUCTURE.DEVICE, { source: dev })
        if (!uuid) throw new DatasetError(`Could not make a dataset for device ${nameOf(dev) ?? dev}.`)
        const name = nameOf(dev)
        if (name) await set_name(client, uuid, name)
        out[dev] = uuid
    }
    return out
}

/* ------------------------------------------------------------------
 * Creating and editing
 * ------------------------------------------------------------------ */

/**
 * @typedef {Object} DatasetSpec
 * @property {string} name
 * @property {string} [description]
 * @property {string|null} kind        equipment, run, process, part or null
 * @property {string[]} items          dataset UUIDs (device datasets included)
 * @property {{from:number,to:number}|null} window  ms, or null
 * @property {string[]} [tags]
 * @property {Object} [labels]         { [item uuid]: label } for equipment
 * @property {Object} [run]            extra run metadata
 * @property {string} createdBy
 */

/** What the service will store for a spec, for the builder's preview. */
export function plan (spec) {
    const steps = []
    const many = spec.items.length > 1 || !spec.window
    if (many) steps.push({ structure: STRUCTURE.UNION, combines: spec.items.length, plumbing: !!spec.window })
    if (spec.window) {
        steps.push({
            structure: STRUCTURE.SESSION,
            from: to_iso(spec.window.from),
            to: to_iso(spec.window.to),
        })
    }
    return steps
}

/**
 * Create a dataset from a spec. Returns the UUID people see.
 *
 * Several items with a window make two datasets: a union of the items,
 * and a session over it. The session is the one that gets the name,
 * kind and metadata; the union is named after it.
 */
export async function create_from_spec (client, spec) {
    if (!spec.name?.trim()) throw new DatasetError('Give the dataset a name.')
    if (!spec.items?.length) throw new DatasetError('Add at least one device or dataset.')
    if (spec.window) {
        const bad = validate_window(spec.window.from, spec.window.to)
        if (bad) throw new DatasetError(bad)
    }

    const saved = []
    try {
        let source = spec.items.length === 1 ? spec.items[0] : null
        if (spec.items.length > 1 || !spec.window) {
            source = await client.DataAccess.create_dataset(STRUCTURE.UNION, spec.items)
            if (!source) throw new DatasetError('The service did not return the new dataset.')
            saved.push(source)
            await set_name(client, source, spec.window ? `${spec.name.trim()} (devices)` : spec.name.trim())
        }

        let uuid = source
        if (spec.window) {
            uuid = await client.DataAccess.create_dataset(STRUCTURE.SESSION, {
                source,
                from: to_iso(spec.window.from),
                to: to_iso(spec.window.to),
            })
            if (!uuid) throw new DatasetError('The service did not return the new dataset.')
            saved.push(uuid)
            await set_name(client, uuid, spec.name.trim())
        }

        await write_metadata(client, uuid, spec)
        return uuid
    }
    catch (err) {
        if (err instanceof DatasetError) { err.saved = saved; throw err }
        throw new DatasetError(saved.length
            ? 'Only part of the dataset was saved.'
            : 'Not saved. Nothing was saved and your changes are still here.',
        { status: err?.status, detail: why(err), saved })
    }
}

async function write_metadata (client, uuid, spec) {
    if (spec.kind) await set_kind(client, uuid, spec.kind)
    if (spec.tags?.length) await set_tags(client, uuid, spec.tags)
    if (spec.kind === 'equipment' && spec.labels) await set_labels(client, uuid, spec.labels)
    await client.ConfigDB.put_config(DA.App.RunMetadata, uuid, {
        createdBy: spec.createdBy ?? null,
        createdAt: to_iso(Date.now()),
        createdVia: spec.createdVia ?? 'desk',
        description: spec.description?.trim() || undefined,
        ...(spec.run ?? {}),
    })
}

/**
 * Which parts of an existing dataset the builder can change in place.
 * A dataset's structure type cannot change, and editing an invalid one
 * makes the service delete config entries, so neither is offered.
 */
export function edit_shape (rec, byUuid) {
    if (!rec?.editable) return { ok: false, reason: 'You cannot edit this dataset.' }
    if (rec.invalid) return { ok: false, reason: 'The service reports this dataset as invalid. Duplicate it instead.' }
    if (rec.structure === STRUCTURE.DEVICE) return { ok: false, reason: 'A device dataset always covers one device.' }
    if (rec.structure === STRUCTURE.UNION) return { ok: true, has_window: false, items_uuid: rec.uuid, items: rec.config ?? [] }
    if (rec.structure === STRUCTURE.SESSION) {
        const src = byUuid[rec.config?.source]
        // A session over its own "(devices)" union: edit that union's items.
        // Only if nothing else includes that union, or editing it would
        // change those datasets too.
        const own = src?.structure === STRUCTURE.UNION && src.name === `${rec.name} (devices)`
            && Object.values(byUuid).every(o => o.uuid === rec.uuid || !direct_sources(o).includes(src.uuid))
        return {
            ok: true,
            has_window: true,
            items_uuid: own ? src.uuid : null,
            items: own ? (src.config ?? []) : [rec.config.source],
        }
    }
    return { ok: false, reason: 'Unknown structure.' }
}

/** Save the builder's changes to an existing dataset. */
export async function update_from_spec (client, rec, spec, byUuid) {
    const shape = edit_shape(rec, byUuid)
    if (!shape.ok) throw new DatasetError(shape.reason)
    if (!!spec.window !== shape.has_window) {
        throw new DatasetError(shape.has_window
            ? 'This dataset has a time window. To remove it, duplicate the dataset without one.'
            : 'This dataset has no time window. To add one, duplicate it with a window.')
    }
    const done = []
    try {
        const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
        if (!same(spec.items, shape.items)) {
            if (shape.items_uuid) {
                await client.DataAccess.update_dataset(shape.items_uuid, STRUCTURE.UNION, spec.items)
                done.push('items')
            }
            else if (spec.items.length === 1) {
                await client.DataAccess.update_dataset(rec.uuid, STRUCTURE.SESSION, {
                    ...rec.config, source: spec.items[0],
                })
                done.push('items')
            }
            else {
                throw new DatasetError('This dataset is limited to one source. Duplicate it to combine several.')
            }
        }
        if (spec.window) {
            const from = to_iso(spec.window.from), to = to_iso(spec.window.to)
            // Compare instants, not strings, so an unchanged window is never rewritten.
            if (Date.parse(from) !== Date.parse(rec.config.from) || Date.parse(to) !== Date.parse(rec.config.to)) {
                const bad = validate_window(from, to)
                if (bad) throw new DatasetError(bad)
                await client.DataAccess.update_dataset(rec.uuid, STRUCTURE.SESSION, {
                    source: done.includes('items') && spec.items.length === 1 && !shape.items_uuid
                        ? spec.items[0] : rec.config.source,
                    from, to,
                })
                done.push('window')
            }
        }
        if (spec.name.trim() !== rec.name) {
            await set_name(client, rec.uuid, spec.name.trim())
            if (shape.items_uuid && shape.items_uuid !== rec.uuid) {
                await set_name(client, shape.items_uuid, `${spec.name.trim()} (devices)`)
            }
            done.push('name')
        }
        await set_kind(client, rec.uuid, spec.kind, rec.kind === 'other' || rec.kind === 'device' ? null : rec.kind)
        const same_list = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
        if (!same_list(normalise_tags(spec.tags), rec.tags)) await set_tags(client, rec.uuid, spec.tags ?? [])
        if (spec.kind === 'equipment' && JSON.stringify(spec.labels ?? {}) !== JSON.stringify(rec.labels ?? {})) {
            await set_labels(client, rec.uuid, spec.labels ?? {})
        }
        if ((spec.description?.trim() || undefined) !== (rec.run?.description || undefined)) {
            await update_run_meta(client, rec.uuid, m => {
                m.description = spec.description?.trim() || undefined
                return m
            })
        }
    }
    catch (err) {
        if (err instanceof DatasetError) throw err
        throw new DatasetError(done.length
            ? `Partly saved (${done.join(', ')}). The rest was not saved.`
            : 'Not saved. Nothing was saved and your changes are still here.',
        { status: err?.status, detail: why(err), saved: done })
    }
}

/* ------------------------------------------------------------------
 * Delete
 * ------------------------------------------------------------------ */

/**
 * Delete a dataset. Data Access refuses (409) while other datasets
 * include it, and lists them; that list comes back as `referrers`.
 */
export async function delete_dataset (client, uuid) {
    const [st, body] = await client.DataAccess.fetch(`v1/delete/${uuid}`)
    if (st === 200 || st === 204 || st === 404) return { ok: true }
    if (st === 409) return { ok: false, referrers: (body?.referrers ?? []).map(r => r.dataset) }
    if (st === 403) return { ok: false, reason: 'You do not have permission to delete this dataset.' }
    return { ok: false, reason: `The service refused (HTTP ${st}).` }
}

/* ------------------------------------------------------------------
 * Data
 * ------------------------------------------------------------------ */

/**
 * The CSV response. `metrics` (full metric names) limits it to those
 * metrics; a Data Access without that filter answers 422.
 */
async function data_response (client, uuid, { metrics = null } = {}) {
    const [st, stream, , headers] = await client.DataAccess.fetch({
        url: `v1/data/${uuid}`,
        method: 'POST',
        accept: 'text/csv',
        response_type: 'stream',
        body: metrics ? { metrics } : {},
    })
    if (st === 403) throw new DatasetError('You do not have permission to read this dataset.', { status: st })
    if (st === 422 && metrics) throw new DatasetError('The service refused the pinned-only download.', { status: st })
    if (st !== 200) throw new DatasetError(`The download failed (HTTP ${st}).`, { status: st })
    return { stream, headers }
}

/** The whole dataset as CSV text, for browser add-ons. */
export async function fetch_csv (client, uuid) {
    const { stream } = await data_response(client, uuid)
    return await new Response(stream).text()
}

/**
 * Download the dataset as a CSV file: all of it, or only `metrics`
 * (full metric names) when given.
 */
export async function download_csv (client, uuid, streamSaver, { metrics = null } = {}) {
    const { stream, headers } = await data_response(client, uuid, { metrics })
    const disposition = headers?.get?.('Content-Disposition') ?? ''
    const filename = /filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i.exec(disposition)?.[2] ?? `${uuid}.csv`
    const out = streamSaver.createWriteStream(filename.replace(/[\/\\]/g, '_'))
    if (window.WritableStream && stream.pipeTo) {
        await stream.pipeTo(out)
    }
    else {
        const writer = out.getWriter()
        const reader = stream.getReader()
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            await writer.write(value)
        }
        await writer.close()
    }
}

/**
 * POST v1/series with a body from series_request(). Returns the parsed
 * answer, or throws a DatasetError people can read.
 */
export async function fetch_series (client, body) {
    const [st, res] = await client.DataAccess.fetch({ url: 'v1/series', method: 'POST', body })
    if (st !== 200) throw new DatasetError(series_error(st, res), { status: st, detail: res?.message })
    return parse_series(res)
}

/* ------------------------------------------------------------------
 * Recordings (kiosk)
 *
 * Start writes a Recording entry on the equipment dataset, so the
 * recording lives on the server: a closed tab or a sleeping tablet
 * loses nothing. Stop makes the run (a session over the equipment) and
 * removes the entry. If making the run fails, the entry stays with its
 * stop time, so anyone can save it later with the same times.
 * ------------------------------------------------------------------ */

export async function start_recording (client, equipment, { by, operator, tags, note, reference, devices, startedAt, resumes }) {
    const rec = {
        startedAt: to_iso(startedAt ?? Date.now()),
        startedBy: by ?? null,
        operator: operator?.trim() || null,
        tags: normalise_tags(tags),
        note: note?.trim() || null,
        reference: reference ?? null,
        devices: devices ?? [],
        resumes: resumes ?? null,
    }
    // Only if there is no recording yet, so two tablets cannot both start.
    const st = await cdb_write(client, { method: 'PUT', app: DA.App.Recording, obj: equipment.uuid, body: rec, ifNoneMatch: '*' })
    if (st === 412) throw new DatasetError('A recording is already running on this equipment.', { status: st })
    if (st !== 204 && st !== 201) throw cdb_fail('The recording did not start.', st)
    return rec
}

/** Change tags, note or operator while recording. */
export async function update_recording (client, equipment_uuid, change) {
    const current = await client.ConfigDB.get_config(DA.App.Recording, equipment_uuid)
    if (!current) throw new DatasetError('This recording has already stopped.')
    const next = change(structuredClone(current)) ?? current
    const patch = merge_patch_of(current, next)
    if (!Object.keys(patch).length) return current
    // Patch only the changed fields, and only while the recording exists,
    // so an edit can neither undo a stop nor bring a stopped one back.
    const st = await cdb_write(client, { method: 'PATCH', app: DA.App.Recording, obj: equipment_uuid, body: patch, merge: true, ifMatch: '*' })
    if (st === 412) throw new DatasetError('This recording has already stopped.', { status: st })
    if (st !== 204) throw cdb_fail('The change was not saved.', st)
    return next
}

/** A readable default name for a run. */
export function run_name (equipment_name, startedAt, reference = null) {
    const d = new Date(startedAt)
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(x => [x.type, x.value]))
    const what = reference ? `${reference} window` : 'run'
    return `${equipment_name} ${what}, ${p.day} ${p.month} ${p.hour}:${p.minute}`
}

/**
 * Stop a recording and save the run. Returns the run's UUID.
 * Safe to call again after a failure: the stop time is kept.
 */
export async function stop_recording (client, equipment, { stoppedAt, by, startedAt } = {}) {
    let rec = await client.ConfigDB.get_config(DA.App.Recording, equipment.uuid)
    if (!rec) throw new DatasetError('There is no recording to stop.', { status: 404 })
    // A stop kept while offline belongs to one recording. If another has
    // started since, leave the new one alone.
    if (startedAt != null && Date.parse(rec.startedAt) !== new Date(startedAt).getTime()) {
        throw new DatasetError('That recording was already stopped elsewhere.', { status: 409 })
    }
    if (!rec.stoppedAt) {
        const stop = { stoppedAt: to_iso(stoppedAt ?? Date.now()), stoppedBy: by ?? null }
        const st = await cdb_write(client, { method: 'PATCH', app: DA.App.Recording, obj: equipment.uuid, body: stop, merge: true, ifMatch: '*' })
        if (st === 412) throw new DatasetError('There is no recording to stop.', { status: 404 })
        if (st !== 204) throw cdb_fail('The stop was not saved.', st)
        rec = { ...rec, ...stop }
    }
    const from = Date.parse(rec.startedAt)
    let to = Date.parse(rec.stoppedAt)
    // A session needs the start strictly before the end.
    if (to <= from) to = from + 1000

    const name = run_name(equipment.name ?? 'Equipment', from, rec.reference)
    // A retry after a failure part-way through finishes the same run.
    let run = rec.run ?? null
    if (!run) {
        try {
            run = await client.DataAccess.create_dataset(STRUCTURE.SESSION, {
                source: equipment.uuid, from: to_iso(from), to: to_iso(to),
            })
            if (!run) throw new Error('no UUID returned')
        }
        catch (err) {
            throw new DatasetError('The dataset was not saved.', { status: err?.status, detail: why(err) })
        }
    }
    // From here the run exists. Metadata failures are reported but the
    // recording entry is still removed, so the run is not saved twice.
    const problems = []
    const attempt = async (what, fn) => { try { await fn() } catch (e) { problems.push(`${what}: ${why(e)}`) } }
    if (!rec.run) {
        await attempt('run', async () => {
            const st = await cdb_write(client, { method: 'PATCH', app: DA.App.Recording, obj: equipment.uuid, body: { run }, merge: true, ifMatch: '*' })
            if (st !== 204) throw { status: st }
        })
    }
    await attempt('name', () => set_name(client, run, name))
    await attempt('kind', () => set_kind(client, run, 'run'))
    if (rec.tags?.length) await attempt('tags', () => set_tags(client, run, rec.tags))
    await attempt('details', () => client.ConfigDB.put_config(DA.App.RunMetadata, run, {
        createdBy: rec.startedBy,
        createdAt: to_iso(Date.now()),
        createdVia: 'kiosk',
        operator: rec.operator,
        note: rec.note,
        equipment: equipment.uuid,
        devices: rec.devices ?? [],
        reference: rec.reference,
        stoppedBy: rec.stoppedBy,
        resumes: rec.resumes ?? undefined,
    }))
    await attempt('recording', () => delete_quietly(client, DA.App.Recording, equipment.uuid))
    return { run, name, from, to, problems }
}

/** Throw away a recording without saving a run. */
export async function discard_recording (client, equipment_uuid) {
    await delete_quietly(client, DA.App.Recording, equipment_uuid)
}

/** Void or restore a run. The dataset is kept; void is advisory. */
export async function set_void (client, uuid, { by, reason } = {}, restore = false) {
    return update_run_meta(client, uuid, m => {
        m.void = restore ? null : { at: to_iso(Date.now()), by: by ?? null, reason: reason ?? null }
        return m
    })
}

/**
 * Resume a run stopped by mistake: void it and carry on recording from
 * its original start.
 */
export async function resume_run (client, equipment, run, { by, operator, tags, note, devices, reference }) {
    // Start first: if that fails, the saved run is left as it was.
    const rec = await start_recording(client, equipment, {
        by, operator, tags, note, devices, reference,
        startedAt: Date.parse(run.from),
        resumes: run.uuid,
    })
    await set_void(client, run.uuid, { by, reason: 'Resumed' })
    return rec
}

/**
 * Correct a run's start or end time. This edits the session, so it is
 * offered only for valid runs, and the change is logged in the run's
 * metadata.
 */
export async function correct_times (client, rec, { from, to, by, reason }) {
    if (rec.invalid || rec.structure !== STRUCTURE.SESSION) throw new DatasetError('Only a valid run can have its times corrected.')
    const bad = validate_window(from, to)
    if (bad) throw new DatasetError(bad)
    const next = { ...rec.config, from: to_iso(from), to: to_iso(to) }
    if (Date.parse(next.from) === Date.parse(rec.config.from) && Date.parse(next.to) === Date.parse(rec.config.to)) {
        throw new DatasetError('The times are the same as before.')
    }
    try {
        await client.DataAccess.update_dataset(rec.uuid, STRUCTURE.SESSION, next)
    }
    catch (err) {
        throw new DatasetError('The times were not changed.', { status: err?.status, detail: why(err) })
    }
    try {
        await update_run_meta(client, rec.uuid, m => {
            m.corrections = [...(m.corrections ?? []), {
                at: to_iso(Date.now()), by: by ?? null, reason: reason ?? null,
                from: [rec.config.from, next.from], to: [rec.config.to, next.to],
            }]
            return m
        })
    }
    catch (err) {
        throw new DatasetError('The times changed, but the note of the correction was not saved.',
            { status: err?.status, detail: why(err), saved: ['times'] })
    }
}

/** Add a run someone forgot to start, over the equipment. */
export async function add_past_run (client, equipment, { from, to, by, operator, tags, note, reference }) {
    const bad = validate_window(from, to)
    if (bad) throw new DatasetError(bad)
    return create_from_spec(client, {
        name: run_name(equipment.name ?? 'Equipment', from, reference),
        kind: 'run',
        items: [equipment.uuid],
        window: { from: Date.parse(from), to: Date.parse(to) },
        tags,
        createdBy: by,
        createdVia: 'kiosk',
        run: { operator: operator?.trim() || null, note: note?.trim() || null, equipment: equipment.uuid, reference: reference ?? null, addedAfter: true },
    })
}

export { direct_sources }
