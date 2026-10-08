/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Pure helpers for the energy and carbon add-on card: whether it
 * applies, and which registers to use. The sums are in
 * lib/datasets/energy.js. Tested in test/datasets-page.test.js.
 */

import { ENERGY_LABEL, STRUCTURE } from '@/lib/datasets/constants.js'
import { find_energy_series, find_intensity_series, find_power_series, power_to_register } from '@/lib/datasets/energy.js'

const ENERGY_UNIT = /^(wh|kwh|mwh)$/i
const POWER_UNIT = /^(w|kw|mw)$/i

/** Does a device metric look like an energy register? */
export function is_energy_metric (m) {
    return ENERGY_UNIT.test((m?.unit ?? '').replace(/\s/g, '')) || /energy/i.test(m?.name ?? '')
}

/** Does a device metric look like active power (W, kW or MW)? */
export function is_power_metric (m) {
    if (/reactive|apparent|factor/i.test(m?.name ?? '')) return false
    return POWER_UNIT.test((m?.unit ?? '').replace(/\s/g, '')) || /active_?power/i.test(m?.name ?? '')
}

/**
 * Whether the add-on applies before any data is read.
 *   { state: 'applies' | 'no-window' | 'no-energy' | 'unknown', reason }
 * `devices` are the device records the dataset covers. With no device
 * metadata to check, the answer is 'unknown' and Calculate is offered.
 */
export function energy_applies (rec, devices) {
    if (!rec?.from || !rec?.to) {
        return {
            state: 'no-window',
            reason: rec?.kind === 'equipment'
                ? 'Equipment has no time window. Open one of its recordings to work out energy and carbon.'
                : 'This dataset has no time window. Energy and carbon needs a start and an end.',
        }
    }
    const known = (devices ?? []).filter(d => Array.isArray(d?.metrics))
    if (!known.length) return { state: 'unknown', reason: null }
    if (!known.some(d => d.metrics.some(m => is_energy_metric(m) || is_power_metric(m)))) {
        return { state: 'no-energy', reason: 'No device in this dataset records energy (Wh, kWh or MWh) or active power (W, kW or MW).' }
    }
    return { state: 'applies', reason: null }
}

/**
 * Sparkplug device IDs of devices labelled "Energy" on any equipment
 * this dataset reaches. `labels` is { [device dataset uuid]: label }.
 */
export function energy_sparkplug_ids (labels, byUuid, deviceByUuid) {
    const out = new Set()
    for (const [dd, label] of Object.entries(labels ?? {})) {
        if ((label ?? '').trim().toLowerCase() !== ENERGY_LABEL.toLowerCase()) continue
        const r = byUuid[dd]
        const dev = r?.structure === STRUCTURE.DEVICE ? deviceByUuid[r.config?.source] : null
        if (dev?.sparkplug) out.add(dev.sparkplug)
    }
    return out
}

/**
 * Choose the meters from the CSV series: one per device. A device's
 * energy register is used when it has one; otherwise its active power,
 * integrated over time (marked `from_power`). Devices labelled Energy
 * win when any of them has either; otherwise every such device is used.
 * Returns { meters, source: 'label' | 'all' }.
 */
export function pick_meters (series, labelled = new Set()) {
    const registers = find_energy_series(series)
    const has_register = new Set(registers.map(s => s.device))
    const all = [
        ...registers,
        ...find_power_series(series).filter(s => !has_register.has(s.device)).map(power_to_register),
    ]
    const preferred = labelled.size ? all.filter(s => labelled.has(s.device)) : []
    const use = preferred.length ? preferred : all
    const seen = new Set()
    const meters = []
    for (const s of use) {
        if (seen.has(s.device)) continue
        seen.add(s.device)
        meters.push(s)
    }
    return { meters, source: preferred.length ? 'label' : 'all' }
}

/** The best grid intensity series, or null. */
export function pick_intensity (series) {
    return find_intensity_series(series)[0] ?? null
}

/** A key for a meter, for the tick boxes. */
export function meter_key (m) {
    return `${m.device}\u0000${m.metric}`
}
