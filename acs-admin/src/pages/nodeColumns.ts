/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import {Badge} from '@/components/ui/badge'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface Host {
    name: string,
    charts: string[],
    cluster: string,
    hostname: string,
    uuid: string,
}

export const nodeColumns: ColumnDef<Host>[] = [
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
        accessorKey: 'hostname',
        accessorFn: (row) => row.hostname,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Hostname'
        }),

        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, row.getValue('hostname'))
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'status',
        accessorFn: (row) => row.status,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Status'
        }),

        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate'}, "Online")
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    }]
