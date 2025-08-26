/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

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
            return h('div', {class: `max-w-[500px] truncate ${(row.getValue('hostname') == null || row.getValue('hostname') === 'Floating') ? 'text-gray-400' : ''}`}, row.getValue('hostname') ?? "Floating")
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    }
]
