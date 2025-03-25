/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface Connection {
    uuid: string,
}

export const connectionColumns: ColumnDef<Connection>[] = [
    {
        accessorKey: 'name',
        accessorFn: (row) => row.name,
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Name'
        }),
        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('name'))
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    }
    // {
    //     accessorKey: 'schema',
    //     accessorFn: (row) => row.configuration.schema.name,
    //     header: ({column}) => h(DataTableColumnHeader, {
    //         column,
    //         title: 'Schema'
    //     }),
    //     cell: ({row}) => {
    //         return h('div', {class: 'max-w-[500px] truncate'}, row.original.configuration.schema.name)
    //     },
    //     filterFn: (row, id, value) => {
    //         return value.includes(row.getValue(id))
    //     },
    // },
    // {
    //     accessorKey: 'version',
    //     accessorFn: (row) => row.configuration.schema.version,
    //     header: ({column}) => h(DataTableColumnHeader, {
    //         column,
    //         title: 'Version'
    //     }),
    //     cell: ({row}) => {
    //         return h('div', {class: 'max-w-[500px] truncate'}, row.original.configuration.schema.version)
    //     },
    //     filterFn: (row, id, value) => {
    //         return value.includes(row.getValue(id))
    //     },
    // }
    ]
