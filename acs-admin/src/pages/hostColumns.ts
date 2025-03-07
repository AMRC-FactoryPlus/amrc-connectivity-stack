/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import {Badge} from '@/components/ui/badge'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface Host {
    arch: string,
    hostname: string,
    k8s_version: string,
    control_plane: boolean,
}

export const hostColumns: ColumnDef<Host>[] = [
    {
        accessorKey: 'hostname',
        accessorFn: (row) => row.hostname,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Hostname'
        }),
        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('hostname')),
                row.original.control_plane ? h('div', {class: 'max-w-[500px] truncate text-gray-400'}, "Control Plane") : null
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'arch',
        accessorFn: (row) => row.arch,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Architecture'
        }),
        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, row.getValue('arch'))
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'k8s_version',
        accessorFn: (row) => row.k8s_version,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'k8s Version'
        }),
        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, row.getValue('k8s_version'))
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
