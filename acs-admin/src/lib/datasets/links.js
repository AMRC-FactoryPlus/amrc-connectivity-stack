/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Links out of the Datasets pages.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'

/**
 * Grafana's address. ACS serves it at grafana.<base domain>, and the
 * Admin UI at admin.<base domain>, so swap the first label. Returns
 * null when the Admin UI is not on that pattern (for example on a dev
 * server), and the page hides the link.
 */
export function grafana_base (host = globalThis.location?.host ?? '') {
    const m = /^[^.]+\.(.+)$/.exec(host)
    if (!m || /^localhost(:\d+)?$/.test(host) || /^\d+\.\d+\.\d+\.\d+/.test(host)) return null
    return `${globalThis.location?.protocol ?? 'https:'}//grafana.${m[1]}`
}

/** Grafana Explore over a dataset's window. A plain link, not filtered. */
export function grafana_link (rec, host) {
    const base = grafana_base(host)
    if (!base) return null
    const from = rec?.from ? Date.parse(rec.from) : 'now-24h'
    const to = rec?.to ? Date.parse(rec.to) : 'now'
    const state = { range: { from: String(from), to: String(to) } }
    return `${base}/explore?schemaVersion=1&panes=${encodeURIComponent(JSON.stringify({ a: state }))}`
}

/** The Data Access URL for a dataset's data, for the API card. */
export async function data_api_url (client, uuid) {
    const base = await client.service_url(UUIDs.Service.DataAccess)
    return new URL(`v1/data/${uuid}`, base.endsWith('/') ? base : `${base}/`).toString()
}

/** The kiosk URL for a piece of equipment, for the QR code. */
export function kiosk_url (equipment_uuid) {
    const loc = globalThis.location
    if (!loc) return `#/kiosk/${equipment_uuid}`
    return `${loc.origin}${loc.pathname}#/kiosk/${equipment_uuid}`
}
