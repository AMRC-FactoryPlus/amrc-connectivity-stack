/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import GroupDropdown from './GroupDropdown.vue'

export interface Group {
    uuid: string
    name: string
    members: string[]
}

export const columns: ColumnDef<Group>[] = [
    {
        accessorKey: 'name',
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Name'
        }),

        cell: ({row}) => {
            return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('name'))
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
        cell: ({row}) => h(GroupDropdown, {row}),
    }]
