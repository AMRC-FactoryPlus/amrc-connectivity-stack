import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface PrincipalMapping {
    uuid: string
    kerberos: string;
}

export const columns: ColumnDef<PrincipalMapping>[] = [{
    accessorKey: 'kerberos',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Principal'
    }),

    cell: ({row}) => {
        return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('kerberos'))
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
}, {
    accessorKey: 'uuid',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'UUID'
    }),

    cell: ({row}) => {
        return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('uuid'))
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
},{
    id: 'actions',
    cell: ({row}) => {
        return h('i', {class: 'fa-solid fa-chevron-right'})
    },
}]
