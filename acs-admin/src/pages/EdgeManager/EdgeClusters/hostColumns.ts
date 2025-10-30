/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface Host {
    arch: string,
    hostname: string,
    k8s_version: string,
    control_plane: boolean,
    os_version: string,
    ready: boolean,
    specialised: string,
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
        accessorKey: 'os_version',
        accessorFn: (row) => row.os_version,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'OS Version'
        }),

        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, row.getValue('os_version'))
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
        accessorKey: 'specialised',
        accessorFn: (row) => row.specialised,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Taint'
        }),
        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, row.getValue('specialised'))
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'ready',
        accessorFn: (row) => row.ready,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Status'
        }),

        cell: ({row}) => {
            return h('div', {class: 'flex max-w-[500px] truncate'}, [
                h('div', {class: `max-w-[500px] truncate px-1.5 py-0.5 rounded-md text-sm font-bold uppercase tracking-wide text-white ${row.getValue('ready') ? 'bg-green-600' : 'bg-red-600'}`},  row.getValue('ready') ? 'Online' : 'Offline'),
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    }]
