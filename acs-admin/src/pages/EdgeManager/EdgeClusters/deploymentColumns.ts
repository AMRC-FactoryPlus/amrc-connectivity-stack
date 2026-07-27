/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import MoveHostButton from '@/components/EdgeManager/Nodes/MoveHostButton.vue'

export interface Host {
    uuid: string,
    name: string,
    deployment: {
        chart: {
            chart: string,
        },
        cluster: string,
        hostname: string,
        name: string,
        createdAt: string,
    }
}

export const deploymentColumns: ColumnDef<Host>[] = [
    {
        accessorKey: 'name',
        accessorFn: (row) => row.name,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Name'
        }),

        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('name')),
                h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.uuid)
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'chart',
        accessorFn: (row) => row.deployment?.chart?.chart ?? "UNKNOWN",
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Chart'
        }),

        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.original.deployment?.chart?.chart ?? "UNKNOWN"),
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'hostname',
        accessorFn: (row) => row.deployment.hostname,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Host'
        }),

        cell: ({row}) => {
            const hostname = row.getValue('hostname') as string
            const floating = hostname == null || hostname === 'Floating'
            return h('div', {class: 'flex items-center gap-1.5 max-w-[500px]'}, [
                h('div', {class: `truncate ${floating ? 'text-gray-400' : ''}`}, hostname ?? "Floating"),
                row.original._hostStale
                    ? h('i', {
                        class: 'fa-solid fa-triangle-exclamation text-amber-500',
                        title: 'This host is not currently part of the cluster',
                    })
                    : null,
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        id: 'actions',
        header: () => null,
        cell: ({row}) => h('div', {class: 'flex items-center justify-end'}, [
            h(MoveHostButton, {
                uuid: row.original.uuid,
                name: row.original.name,
                kind: 'deployment',
                deployment: row.original.deployment,
            }),
        ]),
        enableSorting: false,
        enableHiding: false,
    }
]
