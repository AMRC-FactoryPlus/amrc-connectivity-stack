/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import PrincipalDropdown from './PrincipalDropdown.vue'

export interface Permission {
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
                h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.principal.class.name)
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
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('target')),
                h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.target.class.name)
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        id: 'actions',
        cell: ({row}) => h(PrincipalDropdown, {row}),
    }]
