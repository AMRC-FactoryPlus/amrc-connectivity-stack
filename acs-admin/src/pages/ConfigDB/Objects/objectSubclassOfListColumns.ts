/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import SubclassOfDropdown from "@pages/ConfigDB/Objects/SubclassOfDropdown.vue";

export interface SubclassOfMapping {
    uuid: string
    name: string
    class: {
        uuid: string
        name: string
    }
}

export const subclassOfColumns: ColumnDef<SubclassOfMapping>[] = [{
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
},
    {
        id: 'actions',
        cell: ({row}) => h(SubclassOfDropdown, {row}),
    }]
