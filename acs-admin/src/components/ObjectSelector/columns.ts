/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import {Checkbox} from '@/components/ui/checkbox'
import {get} from 'lodash'

export interface GenericObject {}

export function buildColumns(column1Header, column1MainKey, column1SubKey, column2Header, column2MainKey, column2SubKey): ColumnDef<GenericObject>[] {
    return [
        {
            id: 'select',
            header: ({table}) => h(Checkbox, {
                'modelValue': table.getIsAllPageRowsSelected(),
                'onUpdate:modelValue': (value: boolean) => table.toggleAllPageRowsSelected(!!value),
                'ariaLabel': 'Select all',
            }),
            cell: ({row}) => h(Checkbox, {
                'modelValue': row.getIsSelected(),
                'onUpdate:modelValue': (value: boolean) => row.toggleSelected(!!value),
                'ariaLabel': 'Select row',
            }),
            enableSorting: false,
            enableHiding: false,
        },
        {
            accessorKey: column1MainKey,
            header: ({column}) => h(DataTableColumnHeader, {
                column,
                title: column1Header
            }),
            cell: ({row}) => {
                if (column1SubKey) {
                    return h('div', {class: 'max-w-[500px] truncate'}, [
                        h('div', {class: 'max-w-[500px] truncate font-medium'}, get(row.original, column1MainKey, "Unknown")),
                        h('div', {class: 'max-w-[500px] truncate text-gray-400'}, get(row.original, column1SubKey, "Unknown"))
                    ])
                } else {
                    return h('span', {class: 'max-w-[500px] truncate font-medium'}, get(row.original, column1MainKey, "Unknown"))
                }
            },
        },
        {
            accessorKey: column2MainKey,
            header: ({column}) => h(DataTableColumnHeader, {
                column,
                title: column2Header
            }),
            cell: ({row}) => {
                if (column2SubKey) {
                    return h('div', {class: 'max-w-[500px] truncate'}, [
                        h('div', {class: 'max-w-[500px] truncate font-medium'}, get(row.original, column2MainKey, "Unknown")),
                        h('div', {class: 'max-w-[500px] truncate text-gray-400'}, get(row.original, column2SubKey, "Unknown"))
                    ])
                } else {
                    return h('span', {class: 'max-w-[500px] truncate font-medium'}, get(row.original, column2MainKey, "Unknown"))
                }
            },
        }
    ]

}