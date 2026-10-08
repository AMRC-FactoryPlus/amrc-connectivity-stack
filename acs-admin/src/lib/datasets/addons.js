/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The add-ons the Add-ons page describes. Energy and carbon is the only
 * one that works today; it runs in the browser and stores nothing. The
 * others are listed as coming later.
 *
 * Tested in test/datasets-gaps.test.js.
 */

import { energy_applies } from '@/components/Datasets/addons/energy-logic.js'

export const ADDONS = [
    {
        id: 'energy',
        name: 'Energy and carbon',
        icon: 'bolt',
        available: true,
        needs: 'A power or energy metric (W, kW, Wh or kWh) and a time window. A device labelled Energy is used first.',
        uses: 'A grid carbon intensity metric, if the dataset holds one, for carbon by the half hour.',
        gives: 'kWh, kgCO2e at a fixed factor, kgCO2e from half-hourly grid intensity, a confidence note and a half-hour table.',
        runs: 'In your browser, when you open the dataset\'s Add-ons tab and press Calculate. Nothing is saved.',
    },
    {
        id: 'cycle',
        name: 'Cycle time',
        icon: 'rotate',
        available: false,
        needs: 'A program or execution state metric.',
        uses: 'Nothing else.',
        gives: 'Cycle count, mean and spread of cycle durations, and idle time between cycles.',
        runs: 'Not available yet.',
    },
    {
        id: 'quality',
        name: 'Quality summary',
        icon: 'ruler',
        available: false,
        needs: 'Measurement metrics, for example a probe deviation in mm.',
        uses: 'Tolerances, entered once per metric.',
        gives: 'Pass and fail counts, the worst deviation and a deviation histogram.',
        runs: 'Not available yet.',
    },
]

/**
 * How many datasets an add-on applies to. `records` are dataset
 * records; `devicesOf(record)` gives the device records it covers.
 * Voided datasets are left out. Only energy and carbon can apply.
 */
export function addon_applies_count (id, records, devicesOf) {
    if (id !== 'energy') return 0
    let n = 0
    for (const r of records ?? []) {
        if (!r || r.voided) continue
        if (energy_applies(r, devicesOf(r)).state === 'applies') n++
    }
    return n
}

/** "Applies to 3 of your datasets", or the line for one coming later. */
export function applies_text (addon, count) {
    if (!addon.available) return 'Not available yet'
    if (!count) return 'Applies to none of your datasets yet'
    return `Applies to ${count} of your datasets`
}
