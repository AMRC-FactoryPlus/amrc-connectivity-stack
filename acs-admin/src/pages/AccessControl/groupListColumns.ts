/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

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
        // Use accessorFn to calculate member count
        accessorKey: 'memberCount',
        accessorFn: (row) => row.members?.length || 0,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Member Count'
        }),
        cell: ({row}) => {
            return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('memberCount'))
        },
    },
    {
        id: 'actions',
        cell: ({row}) => {
            return h('i', {class: 'fa-solid fa-chevron-right'})
        },
    }]
