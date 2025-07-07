/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import {formatFileSize} from '@/lib/utils'

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
        file_uuid: string
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
        sortingFn: (rowA, rowB, columnId) => {
            const sizeA = rowA.original.filesConfiguration?.file_size ?? 0;
            const sizeB = rowB.original.filesConfiguration?.file_size ?? 0;
            return sizeA - sizeB;
        },
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
            new Date(row.filesConfiguration.date_uploaded).toLocaleDateString("en-GB", {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }) :
            "--",
        sortingFn: (rowA, rowB, columnId) => {
            const dateA = new Date(rowA.original.filesConfiguration?.date_uploaded ?? 0);
            const dateB = new Date(rowB.original.filesConfiguration?.date_uploaded ?? 0);
            return dateA.getTime() - dateB.getTime();
            },
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
