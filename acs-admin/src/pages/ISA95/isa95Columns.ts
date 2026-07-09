/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import type { ColumnDef } from '@tanstack/vue-table'
import { h } from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface ISA95Node {
    uuid: string,
    name: string,
    level: string,
    aliases: string[],
    children: string[],
    parents: string[],   // parent names, resolved by the page
}

export const isa95Columns: ColumnDef<ISA95Node>[] = [
    {
        accessorKey: 'name',
        accessorFn: (row) => row.name,
        header: ({ column }) => h(DataTableColumnHeader, {
            column,
            title: 'Name'
        }),
        cell: ({ row }) => {
            return h('div', { class: 'max-w-[500px] truncate' }, [
                h('div', { class: 'max-w-[500px] truncate font-medium' }, row.getValue('name')),
                h('div', { class: 'max-w-[500px] truncate text-gray-400' }, row.original.uuid)
            ])
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'level',
        accessorFn: (row) => row.level,
        header: ({ column }) => h(DataTableColumnHeader, {
            column,
            title: 'Level'
        }),
        cell: ({ row }) => h('div', { class: 'truncate' }, row.getValue('level')),
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: 'parents',
        accessorFn: (row) => row.parents.join(', ') || 'None',
        header: ({ column }) => h(DataTableColumnHeader, {
            column,
            title: 'Parent'
        }),
        cell: ({ row }) => h('div', {
            class: row.original.parents.length ? 'truncate' : 'truncate text-gray-400'
        }, row.getValue('parents')),
    },
    {
        accessorKey: 'aliases',
        accessorFn: (row) => row.aliases.join(', '),
        header: ({ column }) => h(DataTableColumnHeader, {
            column,
            title: 'Aliases'
        }),
        cell: ({ row }) => {
            const aliases = row.original.aliases
            return aliases.length
                ? h('div', { class: 'max-w-[300px] truncate' }, aliases.join(', '))
                : h('div', { class: 'text-gray-400' }, 'None')
        },
    },
]
