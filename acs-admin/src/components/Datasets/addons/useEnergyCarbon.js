/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * State for the energy and carbon add-on on one dataset page. The page
 * owns it, so a result survives switching tabs; nothing is saved.
 *
 * States: idle (not calculated), loading, error, empty (no register in
 * the data), ready.
 */

import { ref, shallowRef, computed, watch } from 'vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDatasetsStore } from '@store/useDatasetsStore.js'
import { fetch_csv } from '@/lib/datasets/api.js'
import { parse_csv, series_of, energy_and_carbon } from '@/lib/datasets/energy.js'
import { labels_for } from '../page/page-logic.js'
import { energy_applies, energy_sparkplug_ids, pick_meters, pick_intensity, meter_key } from './energy-logic.js'

export function useEnergyCarbon (record, devices) {
    const ds = useDatasetsStore()
    const state = ref('idle')
    const error = ref(null)
    const meters = shallowRef([])
    const source = ref('all')
    const intensity = shallowRef(null)
    const ticked = ref(new Set())

    const applies = computed(() => energy_applies(record.value, devices.value))

    // A different dataset, or a changed window, makes the result stale.
    // The store rebuilds records on every update, so watch a string.
    const key = computed(() => `${record.value?.uuid}|${record.value?.from ?? ''}|${record.value?.to ?? ''}`)
    watch(key, reset)

    // Derived from the key, so live updates elsewhere do not redo the sums.
    const span = computed(() => {
        const [, from, to] = key.value.split('|')
        return from && to ? { from: Date.parse(from), to: Date.parse(to) } : null
    })

    const result = computed(() => {
        if (state.value !== 'ready' || !span.value) return null
        const use = meters.value.filter(m => ticked.value.has(meter_key(m)))
        if (!use.length) return null
        return energy_and_carbon({
            meters: use,
            intensity: intensity.value?.points ?? null,
            ...span.value,
        })
    })

    function reset () {
        state.value = 'idle'
        error.value = null
        meters.value = []
        intensity.value = null
        ticked.value = new Set()
    }

    async function calculate () {
        const rec = record.value
        if (!rec || !span.value) return
        state.value = 'loading'
        error.value = null
        const asked = key.value
        try {
            const text = await fetch_csv(useServiceClientStore().client, rec.uuid)
            // The dataset or its window changed while downloading.
            if (key.value !== asked) return
            const series = series_of(parse_csv(text))
            const labelled = energy_sparkplug_ids(labels_for(rec, ds.byUuid), ds.byUuid, ds.deviceByUuid)
            const picked = pick_meters(series, labelled)
            meters.value = picked.meters
            source.value = picked.source
            intensity.value = pick_intensity(series)
            ticked.value = new Set(picked.meters.map(meter_key))
            state.value = picked.meters.length ? 'ready' : 'empty'
        }
        catch (err) {
            if (key.value !== asked) return
            console.error('Energy and carbon: calculation failed', err)
            error.value = err?.message ?? 'The calculation failed.'
            state.value = 'error'
        }
    }

    function toggle (m) {
        const next = new Set(ticked.value)
        const k = meter_key(m)
        if (next.has(k)) next.delete(k)
        else next.add(k)
        ticked.value = next
    }

    return { state, error, applies, meters, source, intensity, ticked, result, calculate, toggle, reset }
}
