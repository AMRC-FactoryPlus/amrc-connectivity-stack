/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import type { ColumnDef } from '@tanstack/vue-table'
import { h } from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import { Button } from '@/components/ui/button'

export interface UnitRow {
    uuid: string,
    code: string,
    symbol: string,
    aliases: string[],
    name: string,
    metrics: number,     // metrics whose Eng_Unit is one of its labels
    devices: number,
}

export interface UnknownRow {
    string: string,
    metrics: number,
    devices: number,
    /* What the page suggests, from eng-units-unece.js suggest_for. */
    suggestion: null | { kind: 'alias' | 'create', match: { code: string, symbol: string, name: string } },
}

const header = (title: string) => ({ column }: any) => h(DataTableColumnHeader, { column, title })

const usage = (metrics: number, devices: number) => metrics
    ? h('div', { class: 'truncate' },
        `${metrics} metric${metrics === 1 ? '' : 's'} on ${devices} device${devices === 1 ? '' : 's'}`)
    : h('div', { class: 'text-gray-400' }, 'Not used')

export const unitColumns: ColumnDef<UnitRow>[] = [
    {
        accessorKey: 'symbol',
        header: header('Symbol'),
        cell: ({ row }) => h('div', { class: 'font-mono font-medium' }, row.original.symbol),
    },
    {
        accessorKey: 'name',
        header: header('Name'),
        cell: ({ row }) => h('div', { class: 'max-w-[300px] truncate' }, row.original.name),
    },
    {
        accessorKey: 'code',
        header: header('UNECE code'),
        cell: ({ row }) => h('div', { class: 'font-mono' }, row.original.code),
    },
    {
        accessorKey: 'aliases',
        accessorFn: (row) => row.aliases.join(', '),
        header: header('Aliases'),
        cell: ({ row }) => row.original.aliases.length
            ? h('div', { class: 'max-w-[300px] truncate font-mono' }, row.original.aliases.join(', '))
            : h('div', { class: 'text-gray-400' }, 'None'),
    },
    {
        accessorKey: 'metrics',
        header: header('In use'),
        cell: ({ row }) => usage(row.original.metrics, row.original.devices),
    },
]

/* `act` is called with a row when its button is pressed. */
export function unknownColumns (act: (row: UnknownRow) => void): ColumnDef<UnknownRow>[] {
    return [
        {
            accessorKey: 'string',
            header: header('Eng_Unit'),
            cell: ({ row }) => h('div', { class: 'font-mono font-medium' }, row.original.string),
        },
        {
            accessorKey: 'metrics',
            header: header('In use'),
            cell: ({ row }) => usage(row.original.metrics, row.original.devices),
        },
        {
            id: 'suggestion',
            accessorFn: (row) => row.suggestion?.match.name ?? '',
            header: header('Recognised as'),
            cell: ({ row }) => {
                const s = row.original.suggestion
                return s
                    ? h('div', { class: 'truncate' }, `${s.match.name} (${s.match.code})`)
                    : h('div', { class: 'text-gray-400' }, 'Not recognised')
            },
        },
        {
            id: 'action',
            header: () => '',
            cell: ({ row }) => {
                const s = row.original.suggestion
                const label = s?.kind === 'alias' ? `Add as alias of ${s.match.code}`
                    : s?.kind === 'create' ? `Add unit ${s.match.code}`
                    : 'Choose a unit...'
                return h(Button, {
                    variant: 'outline', size: 'sm',
                    onClick: (e: Event) => { e.stopPropagation(); act(row.original) },
                }, () => label)
            },
            enableSorting: false,
            enableHiding: false,
        },
    ]
}
