/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import MembersDropdown from './MembersDropdown.vue'

export interface Principal {
    uuid: string
    name: string
    kerberos: string
    group: {
        uuid: string
        name: string
    }
    class: {
        uuid: string
        name: string
    }
}

export const columns: ColumnDef<Principal>[] = [
    {
        accessorKey: 'name',
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Name'
        }),

        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('name')),
                h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.class?.name ?? "UNKNOWN"),
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'uuid',
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'UUID'
        }),

        cell: ({row}) => {
            return h('span', {class: 'max-w-[500px] truncate text-gray-500'}, row.getValue('uuid'))
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        id: 'actions',
        cell: ({row}) => h(MembersDropdown, {row}),
    }]
