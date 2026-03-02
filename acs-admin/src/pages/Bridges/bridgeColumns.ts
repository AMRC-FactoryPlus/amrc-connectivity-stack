/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import type { ColumnDef } from '@tanstack/vue-table'
import { h } from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface Bridge {
    uuid: string,
    name: string,
    deployment: {
        chart: {
            chart: string,
        },
        cluster: string,
        hostname: string,
        name: string,
        createdAt: string,
        values?: {
            topics?: string[],
            remote?: {
                host?: string,
                port?: number,
            }
        }
    }
}

export const bridgeColumns: ColumnDef<Bridge>[] = [
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
        accessorKey: 'topics',
        accessorFn: (row) => {
            const topics = row.deployment?.values?.topics ?? []
            return Object.keys(topics).join(', ') || 'No topics'
        },
        header: ({ column }) => h(DataTableColumnHeader, {
            column,
            title: 'Topics'
        }),
        cell: ({ row }) => {
            const topics = row.original.deployment?.values?.topics ?? []
            if (topics.length === 0) {
                return h('div', { class: 'text-gray-400' }, 'No topics')
            }
            return h('div', { class: 'max-w-[300px] truncate' }, Object.keys(topics).join(', '))
        },
    },
    {
        accessorKey: 'remote',
        accessorFn: (row) => {
            const remote = row.deployment?.values?.remote
            return remote?.host ? `${remote.host}:${remote.port || 8883}` : '-'
        },
        header: ({ column }) => h(DataTableColumnHeader, {
            column,
            title: 'Remote Broker'
        }),
        cell: ({ row }) => {
            const remote = row.original.deployment?.values?.remote
            if (!remote?.host) {
                return h('div', { class: 'text-gray-400' }, '-')
            }
            return h('div', { class: 'max-w-[300px] truncate font-mono text-sm' },
                `${remote.host}:${remote.port || 8883}`)
        },
    },
    {
        accessorKey: 'hostname',
        accessorFn: (row) => row.deployment?.hostname ?? 'Floating',
        header: ({ column }) => h(DataTableColumnHeader, {
            column,
            title: 'Host'
        }),
        cell: ({ row }) => {
            const hostname = row.getValue('hostname') as string
            const isFloating = hostname === 'Floating' || !hostname
            return h('div', { class: isFloating ? 'text-gray-400' : '' }, hostname || 'Floating')
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    }
]
