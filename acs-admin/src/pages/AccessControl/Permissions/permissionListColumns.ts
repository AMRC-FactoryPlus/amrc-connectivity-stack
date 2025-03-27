/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface Permission {
    uuid: string
    name: string
    class: {
        uuid: string
        name: string
    }
}

export const columns: ColumnDef<Permission>[] = [
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
        accessorKey: 'class',
        accessorFn: (row) => row.class.name,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Group Type'
        }),

        cell: ({row}) => {
            return h('span', {class: 'max-w-[500px] truncate text-gray-500'}, row.getValue('class'))
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
    ]
