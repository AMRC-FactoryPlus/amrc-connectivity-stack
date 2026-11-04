/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import RebirthButton from '@/components/EdgeManager/RebirthButton.vue'
import I3xAccessButton from '@/components/Access/I3xAccessButton.vue'
import {useISA95Store} from '@/store/useISA95Store.js'
import {extract_hierarchy} from '@/composables/useISA95Migration.js'
import {resolve_isa95} from '@/lib/access/i3x-access.js'

export interface Device {
    uuid: string,
    name: string,
    sparkplugName: string,
    node: string,
    connection: string,
    schema: string,
    originMap: string
}

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
        // Opens the i3X access dialog for the device. The button stops
        // the click, so the rest of the row still opens the device.
        id: 'i3x',
        header: () => h('div', {class: 'w-[200px]'}, 'i3X access'),
        cell: ({row}) => {
            const chain = extract_hierarchy(row.original)?.chain ?? []
            return h(I3xAccessButton, {
                target: row.original.uuid,
                device: true,
                via: resolve_isa95(useISA95Store().data, chain),
                noun: 'device',
                name: row.original.name,
                path: chain.join(' / '),
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
