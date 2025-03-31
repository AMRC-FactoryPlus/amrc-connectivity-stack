/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {usePrincipalStore} from "@store/usePrincipalStore.js"
import {useDialog} from '@/composables/useDialog';

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import {toast} from "vue-sonner";

export interface ApplicationMapping {
    uuid: string
    name: string
    class: {
        uuid: string
        name: string
    }
    application: {
        uuid: string
        name: string
    }
}

export const columns: ColumnDef<ApplicationMapping>[] = [{
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
    id: 'actions',
    cell: ({row}) => {
        return h('div', {onClick: async (e) => {
            e.stopPropagation()
            useDialog({
                title: 'Remove Config Entry?',
                message: `Are you sure you want to delete the config entry for "${row.getValue('name')}" from ${row.original.application.name}`,
                confirmText: 'Remove',
                onConfirm: async () => {
                    try {
                        await useServiceClientStore().client.ConfigDB.delete_config(row.original.application.uuid, row.original.uuid)
                        toast.success(`Entry for ${row.original.name} has been deleted`)
                    } catch (err) {
                        toast.error(`Unable to delete entry for ${row.original.name}`)
                    }
                }
            });
        }, class: ''}, [
            h('i', {class: 'fa-solid fa-fw fa-trash text-red-500'})
        ])
    },
}]
