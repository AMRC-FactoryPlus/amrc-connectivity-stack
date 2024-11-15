/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import {Badge} from '@/components/ui/badge'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

interface Object {
    uuid: string,
    name: string,
}

export interface EffectivePermission {
    permission: Object,
    target: Object,
}

export const columns: ColumnDef<EffectivePermission>[] = [{
    accessorKey: 'permission.name',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Permission'
    }),

    cell: ({row}) => {
        return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.original.permission.name)
    },
}, {
    accessorKey: 'target.name',
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
        return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.original.target.name);
    },
}]
