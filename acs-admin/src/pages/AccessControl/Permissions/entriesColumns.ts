/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import {Badge} from '@/components/ui/badge'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import EntriesDropdown from './EntriesDropdown.vue'

export interface Permission {
    uuid: string
    principal: {
        uuid: string
        name: string
        class: {
            uuid: string
            name: string
        }
    }
    target: {
        uuid: string
        name: string
        class: {
            uuid: string
            name: string
        }
    }
    permission: {
        uuid: string
        name: string
    }
    plural: boolean
}

export const columns: ColumnDef<Permission>[] = [
    {
        accessorKey: 'principal',
        accessorFn: (row) => row.principal.name,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Principal'
        }),

        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('principal')),
                h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.principal?.class?.name ?? "UNKNOWN")
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'target',
        accessorFn: (row) => row.target.name,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Target'
        }),

        cell: ({row}) => {
            if (row.original.target.uuid === '00000000-0000-0000-0000-000000000000') {
                return h(Badge, {variant: 'destructive'}, {
                    default: () => row.original.target.name
                });
            }
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('target')),
                h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.target?.class?.name ?? "UNKNOWN")
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'plural',
        accessorFn: (row) => row.plural,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Plural target'
        }),

        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate font-medium'},
                row.original.plural ? '🗸' : '🗴')
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        id: 'actions',
        cell: ({row}) => h(EntriesDropdown, {row}),
    }]
