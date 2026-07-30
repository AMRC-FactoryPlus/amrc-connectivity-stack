/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import type { ColumnDef } from '@tanstack/vue-table'
import { h } from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import { originOf } from '@/lib/schema/presentation.js'

export interface SchemaRow {
    uuid: string,
    schemaUuid: string,
    name: string,
    version: number,
    origin: string,          // 'AMRC library' | 'Local'
    isLibrary: boolean,
    isDraft: boolean,
    usedBy: number,
    referencedBy: number,
    supersededBy: string | null,
    derivedFrom: string | null,
}

const badge = (text: string, classes: string) =>
    h('span', {
        class: 'ml-2.5 inline-flex items-center rounded-md px-2 py-0.5 text-xs '
            + 'font-normal whitespace-nowrap ' + classes,
    }, text)

const draftBadge = () =>
    h('span', {
        class: 'ml-2.5 inline-flex items-center gap-1.5 rounded-md border border-dashed '
            + 'border-slate-200 px-2 py-0.5 text-xs font-normal whitespace-nowrap',
    }, [h('i', { class: 'fa-solid fa-pen text-[8px]' }), 'Draft'])

/* Grey is for absence, not for small numbers. */
const count = (n: number, isDraft: boolean) =>
    h('div', { class: `text-right font-medium ${n && !isDraft ? '' : 'text-gray-400'}` },
        isDraft ? '-' : String(n))

export const schemaColumns: ColumnDef<SchemaRow>[] = [
    {
        id: 'glyph',
        enableHiding: false,
        enableSorting: false,
        header: () => h('span'),
        cell: ({ row }) => {
            const origin = originOf(row.original)
            return h('i', {
                class: `fa-solid text-[10px] ${origin.icon} ${origin.colour}`,
                title: origin.label,
            })
        },
    },
    {
        accessorKey: 'name',
        accessorFn: (row) => row.name,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Name' }),
        /* Name over version, the same stacked cell the other tables use
         * for name over UUID. The version has no column of its own; two
         * versions of one schema sort next to each other and the subline
         * says which is which. */
        cell: ({ row }) => h('div', { class: 'max-w-[500px] truncate' }, [
            h('div', { class: 'flex items-center' }, [
                h('span', { class: 'max-w-[500px] truncate font-medium' },
                    row.original.name),
                row.original.isDraft
                    ? draftBadge()
                    : row.original.supersededBy
                        ? badge('Superseded', 'bg-slate-100 text-slate-500')
                        : null,
            ]),
            h('div', { class: 'max-w-[500px] truncate text-gray-400' },
                row.original.isDraft
                    ? 'Not published'
                    : `Version ${row.original.version}`),
        ]),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        accessorKey: 'origin',
        accessorFn: (row) => row.origin,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Origin' }),
        cell: ({ row }) => h('div', { class: 'truncate font-medium' }, row.original.origin),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        accessorKey: 'usedBy',
        accessorFn: (row) => row.usedBy,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Devices' }),
        cell: ({ row }) => count(row.original.usedBy, row.original.isDraft),
    },
    {
        accessorKey: 'referencedBy',
        accessorFn: (row) => row.referencedBy,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Used by' }),
        cell: ({ row }) => count(row.original.referencedBy, row.original.isDraft),
    },
]
