/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import type { ColumnDef } from '@tanstack/vue-table'
import { h } from 'vue'
import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

// App UUIDs for dataset structure types (from acs-data-access/lib/constants.js)
export const STRUCTURE_APPS = {
    SPARKPLUG: 'f5d550c4-2831-11f1-b0b0-83fda3035799',
    SESSION:   '8754c000-3778-4ae6-b2b8-bbcd959bb775',
    UNION:     '1c4ca454-de38-44d9-92fb-aa5218bfa257',
    INVALID:   '696396a0-2831-11f1-9b12-33d63b8c5115',
}

const STRUCTURE_LABELS: Record<string, string> = {
    [STRUCTURE_APPS.SPARKPLUG]: 'Sparkplug Source',
    [STRUCTURE_APPS.SESSION]:   'Session',
    [STRUCTURE_APPS.UNION]:     'Union',
    [STRUCTURE_APPS.INVALID]:   'Invalid',
}

export function structure_label (uuid: string): string {
    return STRUCTURE_LABELS[uuid] ?? 'Unknown'
}

function format_date (dateStr?: string): string {
    if (!dateStr) return '—'
    try {
        return new Date(dateStr).toLocaleString()
    } catch {
        return dateStr
    }
}

export interface DatasetMetadata {
    uuid: string
    name?: string
    from?: string
    to?: string
    function?: string[]
    metadata?: Record<string, any>
    parts?: string[]
}

export interface DatasetStructure {
    uuid: string
    structure: string
    config?: any
    name?: string   // injected by the page from the metadata store
}

export const metadataColumns: ColumnDef<DatasetMetadata>[] = [
    {
        accessorKey: 'name',
        accessorFn: row => row.name ?? row.uuid,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Name' }),
        cell: ({ row }) => h('div', { class: 'max-w-[400px]' }, [
            h('div', { class: 'font-medium truncate' }, row.original.name ?? 'Unknown'),
            h('div', { class: 'text-gray-400 text-xs truncate' }, row.original.uuid),
        ]),
    },
    {
        accessorKey: 'from',
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'From' }),
        cell: ({ row }) => h('div', { class: 'text-sm whitespace-nowrap' }, format_date(row.original.from)),
    },
    {
        accessorKey: 'to',
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'To' }),
        cell: ({ row }) => h('div', { class: 'text-sm whitespace-nowrap' }, format_date(row.original.to)),
    },
    {
        accessorKey: 'parts',
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Parts' }),
        cell: ({ row }) => {
            const count = row.original.parts?.length ?? 0
            return h('div', { class: 'text-sm text-gray-500' }, count > 0 ? `${count}` : '—')
        },
    },
]

export const structureColumns: ColumnDef<DatasetStructure>[] = [
    {
        accessorKey: 'name',
        accessorFn: row => row.name ?? row.uuid,
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Dataset' }),
        cell: ({ row }) => h('div', { class: 'max-w-[400px]' }, [
            h('div', { class: 'font-medium truncate' }, row.original.name ?? '—'),
            h('div', { class: 'text-gray-400 text-xs font-mono truncate' }, row.original.uuid),
        ]),
    },
    {
        accessorKey: 'structure',
        header: ({ column }) => h(DataTableColumnHeader, { column, title: 'Type' }),
        cell: ({ row }) => {
            const label = structure_label(row.original.structure)
            const is_invalid = row.original.structure === STRUCTURE_APPS.INVALID
            return h('div', {
                class: `text-sm font-medium ${is_invalid ? 'text-red-500' : 'text-gray-700'}`,
            }, label)
        },
    },
]
