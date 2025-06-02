/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import FilesTableRowActions from "@pages/Files/TableData/FilesTableRowActions.vue";

export interface ApplicationMapping {
    uuid: string
    name: string
    filesConfiguration: {
        created: Date
        user_who_uploaded: string
        original_file_name: string
        file_size: number
        date_uploaded: string
    }
}

export const columns: ColumnDef<ApplicationMapping>[] = [
    {
    accessorKey: 'name',
    accessorFn: (row) => row?.filesConfiguration?.original_file_name ?? row.name,
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
    },
    {
        accessorKey: 'size',
        accessorFn: (row) => row?.filesConfiguration?.file_size ? formatFileSize(row.filesConfiguration.file_size) : "--",
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Size'
        }),
        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('size')),
            ])
        },
    },
    {
    accessorKey: 'created',
    accessorFn: (row) => row?.filesConfiguration?.date_uploaded ?
        new Date(row.filesConfiguration.date_uploaded).toLocaleDateString("en-GB") :
        "--",
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Created'
    }),
    cell: ({row}) => {
        return h('div', {class: 'max-w-[500px] truncate'}, [
            h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('created')),
            ])
        },
    },
    {
        accessorKey: 'createdBy',
        accessorFn: (row) => row?.filesConfiguration?.user_who_uploaded ?? "--",
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: 'Created By'
        }),
        cell: ({row}) => {
            return h('div', {class: 'max-w-[500px] truncate'}, [
                h('div', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('createdBy')),
            ])
        },
    },
    {
    id: 'actions',
        header: ({column}) => h(DataTableColumnHeader, {
            column,
            title: ''
        }),
        cell: ({row}) => h(FilesTableRowActions, {row}),
    }]

function formatFileSize(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
