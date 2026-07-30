/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import type { ColumnDef } from '@tanstack/vue-table'
import { h } from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface SchemaRow {
    uuid: string,
    name: string,
    version: number,
    origin: string,        // 'AMRC library' | 'Local' | 'Draft'
    isDraft: boolean,
    usedBy: number,
    referencedBy: number,
    supersededBy: string | null,
}

const badge = (text: string, classes: string) =>
    h('span', {
        class: `inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${classes}`,
    }, text)

export const schemaColumns: ColumnDef<SchemaRow>[] = [
    {
        accessorKey: 'name',
        accessorFn: (row) => row.name,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Name' }),
        cell: ({ row }) => h('div', { class: 'max-w-[420px]' }, [
            h('div', { class: 'truncate font-medium' }, [
                row.original.name,
                row.original.supersededBy
                    ? h('span', { class: 'ml-2' },
                        [badge('Superseded', 'bg-amber-100 text-amber-800')])
                    : null,
            ]),
            h('div', { class: 'truncate text-gray-400 text-xs' }, row.original.uuid),
        ]),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        accessorKey: 'version',
        accessorFn: (row) => row.version,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Version' }),
        cell: ({ row }) => h('div', { class: 'truncate' },
            row.original.isDraft ? '-' : `v${row.original.version}`),
    },
    {
        accessorKey: 'origin',
        accessorFn: (row) => row.origin,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Origin' }),
        cell: ({ row }) => {
            const origin = row.original.origin
            const classes = origin === 'AMRC library'
                ? 'bg-slate-100 text-slate-700'
                : origin === 'Draft'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-emerald-100 text-emerald-800'
            return h('div', {}, [badge(origin, classes)])
        },
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        accessorKey: 'usedBy',
        accessorFn: (row) => row.usedBy,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Devices' }),
        cell: ({ row }) => {
            if (row.original.isDraft) return h('div', { class: 'text-gray-400' }, '-')
            const n = row.original.usedBy
            return h('div', { class: n ? '' : 'text-gray-400' },
                n === 0 ? 'None' : String(n))
        },
    },
    {
        accessorKey: 'referencedBy',
        accessorFn: (row) => row.referencedBy,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Used in schemas' }),
        cell: ({ row }) => {
            if (row.original.isDraft) return h('div', { class: 'text-gray-400' }, '-')
            const n = row.original.referencedBy
            return h('div', { class: n ? '' : 'text-gray-400' },
                n === 0 ? 'None' : String(n))
        },
    },
]
