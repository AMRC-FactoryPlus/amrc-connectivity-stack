/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import {Badge} from '@/components/ui/badge'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface EffectivePermission {
    permission: {
        uuid: string,
        name: string,
        class: {
            uuid: string
            name: string
        }
    },
    target: {
        uuid: string,
        name: string,
        class: {
            uuid: string
            name: string
        }
    },
}

export const columns: ColumnDef<EffectivePermission>[] = [{
    accessorKey: 'permission',
    accessorFn: (row) => row.permission.name,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Permission'
    }),
    cell: ({row}) => {
        return h('div', {class: 'max-w-[500px] truncate'}, [
            h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('permission')),
            h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.permission?.class?.name ?? "UNKNOWN")
        ])
    },
}, {
    accessorKey: 'target',
    accessorFn: (row) => row.target.name,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Target'
    }),

    cell: ({row}) => {
        if (row.original.target.uuid === '00000000-0000-0000-0000-000000000000') {
            return h(Badge, {variant: 'destructive'}, {
                default: () => row.original.target.name
            });
        }
        return h('div', {class: 'max-w-[500px] truncate'}, [
            h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('target')),
            h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.target?.class?.name ?? "UNKNOWN")
        ])
    },
}]
