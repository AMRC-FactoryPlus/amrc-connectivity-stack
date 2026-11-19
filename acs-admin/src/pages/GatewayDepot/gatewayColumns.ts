/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import type {ColumnDef} from '@tanstack/vue-table'
import {h} from 'vue'
import {RouterLink} from 'vue-router'

import DataTableColumnHeader from '@/components/ui/data-table/DataTableColumnHeader.vue'
import StatePill from '@/components/GatewayDepot/StatePill.vue'

/* One row of the list, as row_of() in lib/gateway-depot/model.js makes
 * it. Every string comes from the service or the gateway, so cells
 * render them as text. */
export interface GatewayRow {
    id: string,
    name: string,
    second: string,
    second_mono: boolean,
    hardware: string,
    serial: string,
    label: string,
    tone: string,
    bad: boolean,
    lost: boolean,
    contact: string,
    /* This tab holds the gateway's one-time admin password. */
    password: boolean,
}

const nameColumn: ColumnDef<GatewayRow> = {
    accessorKey: 'name',
    accessorFn: (row) => row.name,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Gateway'
    }),
    cell: ({row}) => {
        const r = row.original
        return h('div', {class: 'max-w-[500px] min-w-0'}, [
            h('div', {class: 'flex flex-wrap items-center gap-x-2 gap-y-1'}, [
                h(RouterLink, {
                    to: {name: 'GatewayDepotGateway', params: {id: r.id}},
                    class: 'font-medium break-words hover:underline',
                    onClick: (e: Event) => e.stopPropagation(),
                }, () => r.name),
                r.password ? h('span', {class: 'rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900'}, 'Password') : null,
            ]),
            r.second ? h('div', {class: `break-all text-gray-400 ${r.second_mono ? 'font-mono text-xs' : ''}`}, r.second) : null,
        ])
    },
}

const statusColumn: ColumnDef<GatewayRow> = {
    accessorKey: 'label',
    accessorFn: (row) => row.label,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Status'
    }),
    cell: ({row}) => {
        const r = row.original
        return h('div', {class: 'flex flex-col items-start gap-1'}, [
            h(StatePill, {label: r.label, tone: r.tone}),
            r.contact ? h('div', {class: 'text-xs font-medium text-amber-700'}, [
                h('i', {class: 'fa-solid fa-triangle-exclamation mr-1'}),
                r.contact,
            ]) : null,
        ])
    },
}

const hardwareColumn: ColumnDef<GatewayRow> = {
    accessorKey: 'hardware',
    accessorFn: (row) => row.hardware,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Hardware'
    }),
    cell: ({row}) => {
        return h('div', {class: 'max-w-[300px] truncate'}, row.getValue('hardware'))
    },
}

const serialColumn: ColumnDef<GatewayRow> = {
    accessorKey: 'serial',
    accessorFn: (row) => row.serial,
    header: ({column}) => h(DataTableColumnHeader, {
        column,
        title: 'Serial number'
    }),
    cell: ({row}) => {
        return h('div', {class: 'max-w-[300px] truncate font-mono text-xs'}, row.getValue('serial'))
    },
}

export const gatewayColumns: ColumnDef<GatewayRow>[] = [nameColumn, statusColumn, hardwareColumn, serialColumn]

/* On a narrow screen there is room for the gateway and its status. */
export const gatewayColumnsNarrow: ColumnDef<GatewayRow>[] = [nameColumn, statusColumn]
