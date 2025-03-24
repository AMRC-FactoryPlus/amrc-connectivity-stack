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

export interface PrincipalMapping {
    uuid: string
    kerberos: string
    name: string
    class: {
        uuid: string
        name: string
    }
}

export const columns: ColumnDef<PrincipalMapping>[] = [{
    accessorKey: 'name',
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Name'
    }),

    cell: ({row}) => {
        return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('name'))
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
}, {
    accessorKey: 'class',
    accessorFn: (row) => row.class.name,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Account Type'
    }),

    cell: ({row}) => {
        return h('span', {class: 'max-w-[500px] truncate font-medium'}, row.getValue('class'))
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
}, {
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
        return h('span', {class: 'max-w-[500px] truncate text-gray-500'}, row.getValue('uuid'))
    },
    filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
    },
},{
    id: 'actions',
    cell: ({row}) => {
        return h('div', {onClick: async (e) => {
            e.stopPropagation()
            useDialog({
                title: 'Remove Principal Mapping?',
                message: `Are you sure you want to delete the principal mapping for ${row.getValue('uuid')}`,
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
