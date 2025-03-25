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
    objects: [
        {
            uuid: string
            name: string
        }
    ]
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
    accessorKey: 'entries',
    accessorFn: (row) => row.objects ? row.objects.length : 0,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Config Entries'
    }),
    cell: ({row}) => {
        return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('entries'))
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
                title: 'Remove Application?',
                message: `Are you sure you want to delete the application "${row.getValue('name')}"`,
                confirmText: 'Remove',
                onConfirm: async () => {
                    try {
                        await useServiceClientStore().client.Auth.delete_principal(row.getValue('uuid'))
                        toast.success(`${row.getValue('uuid')} has been deleted`)
                        useServiceClientStore().client.Fetch.cache = "reload"
                        await usePrincipalStore().fetch()
                        useServiceClientStore().client.Fetch.cache = "default"
                    } catch (err) {
                        toast.error(`Unable to delete ${row.getValue('uuid')}`)
                    }
                }
            });
        }, class: ''}, [
            h('i', {class: 'fa-solid fa-fw fa-trash text-red-500'})
        ])
    },
}]
