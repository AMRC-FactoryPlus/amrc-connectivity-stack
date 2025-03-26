/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import MembersDropdown from "@pages/ConfigDB/Objects/MembersDropdown.vue";
import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'

export interface ApplicationMapping {
    uuid: string
    name: string
    class: {
        uuid: string
        name: string
    }
    direct: string
}

export const membersColumns: ColumnDef<ApplicationMapping>[] = [{
    accessorKey: 'name',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Name'
    }),
    cell: ({row}) => {
        return h('div', {class: 'max-w-[500px] truncate'}, [
            h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('name')),
            h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.uuid ?? "UNKNOWN")
        ])
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
}, {
    accessorKey: 'class',
    accessorFn: (item) => item.class.name,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Class'
    }),
    cell: ({row}) => {
        return h('div', {class: 'max-w-[500px] truncate'}, [
            h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('class')),
            h('div', {class: 'max-w-[500px] truncate text-gray-400'}, row.original.class?.uuid ?? "UNKNOWN")
        ])
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
}, {
    accessorKey: 'direct',
    accessorFn: (item) => item.direct,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Direct'
    }),
    cell: ({row}) => {
        return h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('direct'))
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
},
    {
        id: 'actions',
        cell: ({row}) => h(MembersDropdown, {row}),
    }]
