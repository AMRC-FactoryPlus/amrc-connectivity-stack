/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import RebirthButton from '@/components/EdgeManager/RebirthButton.vue'
import I3xAccessButton from '@/components/Access/I3xAccessButton.vue'
import PlacementPill from '@/components/ISA95/PlacementPill.vue'
import {useISA95Store} from '@/store/useISA95Store.js'
import {placement_chain, placement_state} from '@/lib/isa95-placement.js'

export interface Device {
    uuid: string,
    name: string,
    sparkplugName: string,
    node: string,
    connection: string,
    schema: string,
    originMap: string
}

/* Where a device stands on the UNS, from placement_state. The Node page
 * works this out once per row as `_placement`, so the table re-sorts and
 * re-filters when the vocabulary changes. Null until the vocabulary has
 * loaded, so no device shows as broken while it loads. */
function placementOf(row: any) {
    if (row._placement !== undefined) return row._placement
    const isa95 = useISA95Store()
    if (!isa95.ready) return null
    return placement_state(isa95.vocabulary, row.placement, row.uuid)
}

/* 'on' or 'off' the UNS, for the UNS filter, or null while loading. */
function unsOf(row: any) {
    const p = placementOf(row)
    if (!p) return null
    return p.state === 'placed' ? 'on' : 'off'
}

const pathText = (row: any) => placementOf(row)?.path?.join(' / ') ?? ''

export const deviceColumns: ColumnDef<Device>[] = [
    {
        accessorKey: 'name',
        accessorFn: (row) => row.name,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Name'
        }),
        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('name'))
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        // The device's ISA-95 placement, or a warning pill when the
        // device is not on the UNS. Unplaced devices sort first.
        id: 'uns',
        accessorFn: (row) => unsOf(row),
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'ISA-95 placement'
        }),
        cell: ({row}) => {
            const p = placementOf(row.original)
            if (!p) return null
            if (p.state === 'placed') {
                const path = p.path.join(' / ')
                return h('div', {class: 'max-w-[300px] truncate text-gray-500', title: path}, path)
            }
            return h(PlacementPill, {state: p.state, error: p.error ?? null, tooltip: true})
        },
        sortingFn: (a, b) => pathText(a.original).localeCompare(pathText(b.original)),
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        // Opens the i3X access dialog for the device. The button stops
        // the click, so the rest of the row still opens the device.
        id: 'i3x',
        header: () => h('div', {class: 'w-[200px]'}, 'Access'),
        cell: ({row}) => {
            const via = placement_chain(useISA95Store().vocabulary, row.original.placement)
            return h(I3xAccessButton, {
                target: row.original.uuid,
                device: true,
                via,
                noun: 'device',
                name: row.original.name,
                path: via.map(n => n.name).join(' / '),
            })
        },
        enableSorting: false,
        enableHiding: false,
    },
    {
        id: 'actions',
        header: () => null,
        cell: ({row}) => {
            const addr = row.original._nodeAddress
            const sparkplugName = row.original.deviceInformation?.sparkplugName
            if (!addr || !sparkplugName) return null
            const addressStr = `${addr.group_id}/${addr.node_id}/${sparkplugName}`
            return h(RebirthButton, {
                address: addressStr,
                name: row.original.name,
                isDevice: true,
                canRebirth: row.original._canRebirth ?? false,
            })
        },
        enableSorting: false,
        enableHiding: false,
    }
    // {
    //     accessorKey: 'schema',
    //     accessorFn: (row) => row.configuration.schema.name,
    //     header: ({column}) => h(DataTableColumnHeader, {
    //         column,
    //         title: 'Schema'
    //     }),
    //     cell: ({row}) => {
    //         return h('div', {class: 'max-w-[500px] truncate'}, row.original.configuration.schema.name)
    //     },
    //     filterFn: (row, id, value) => {
    //         return value.includes(row.getValue(id))
    //     },
    // },
    // {
    //     accessorKey: 'version',
    //     accessorFn: (row) => row.configuration.schema.version,
    //     header: ({column}) => h(DataTableColumnHeader, {
    //         column,
    //         title: 'Version'
    //     }),
    //     cell: ({row}) => {
    //         return h('div', {class: 'max-w-[500px] truncate'}, row.original.configuration.schema.version)
    //     },
    //     filterFn: (row, id, value) => {
    //         return value.includes(row.getValue(id))
    //     },
    // }
    ]
